import { writeFile } from 'fs/promises';
import { readdir } from 'fs/promises';
import { readFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import luaparse from 'luaparse';
import path from 'path';
import * as OpenCC from 'opencc-js';

// 路徑常數
const GAME_PATH = './Game';
const DATA_PATH = './Data';

// 全域緩存
const CACHE = {
  MISC: null,
  SPECIAL: null,
  TALENT: null,
  EFFECT: null,
  BOOK: null,
  EQUIP: null,
  SKILL: null,
  FLAG: null,
  GROUP: {},
  GROUPSTAT: {},
  CONDITION: null,
  SWITCH: null,
  DICE: null,
  MISSION: null,
  TRIGGER: null,
  COMBAT: null,
  COMBAT_FULL: null,
  COMBAT_INDEX: {},
  BATTLE: null,
  POSITION: null,
  SCRIPT: null,
  SCRIPT_FULL: null,
  SCRIPT_INDEX: {},
  SCRIPT_FREE: {},
  STAT: {},
  TIME: {},
  DEAD: {},
  END: {},
  ACHIEVEMENT: {},
  CHARACTER: {},
  TERM: { COMBAT_SKILL: {}, CHARACTER: {}, TEAM: {} }
};
const CACHE_FULFILL = {
  MISC: false,
  SPECIAL: false,
  TALENT: false,
  EFFECT: false,
  BOOK: false,
  EQUIP: false,
  SKILL: false,
  FLAG: false,
  GROUP: false,
  CONDITION: false,
  SWITCH: false,
  DICE: false,
  MISSION: false,
  TRIGGER: false,
  COMBAT: false,
  BATTLE: false,
  POSITION: false,
  SCRIPT: false,
  TERM: false
};
const REF_MAP = { CHARACTER: {}, MISC: {}, SPECIAL: {}, TALENT: {}, BOOK: {}, EQUIP: {} };

// 重複使用之Regex規則
const REGEX_UID = /(_\d+)(\.json)?$/;
const REGEX_EXT = /(\.json|\.lua)$/;
const REGEX_TIME = /第.年..?月.旬/;
const REGEX_CAMEL_KEBAB = /([a-z])([A-Z])/g;
const REGEX_UNDERSCORE = /_/g;
const REGEX_RELATIONSHIP = /^relationship_(.+?)(?:_[^_]+)?_\d+$/i;
const REGEX_STAT_PREFIX = /^(Player|Faction)_/;
const REGEX_ENEMY_STAT = /enemy_(\d{3})_(\w+)/i;
const REGEX_CHAR_EXTRA = /^(\w+)_(\d+|young|upper|lower|look|hand)(_\d+)?$/;
const REGEX_CHAR_MAJOR = /^(dio\d+|big|girl\d+|special\d+|sister\d+|brother\d+|master|player)(_\w+)*$/;
const REGEX_CONDITION = /^\[%(.+)%\]$/;

// 參照用常數
const STAGE_MAP = { 上旬: '1', 中旬: '2', 下旬: '3' };
const LOVER_MAP = { 0: 'sister1', 1: 'girl1', 2: 'girl2', 3: 'girl5', 4: 'girl9', 5: 'girl6', 6: 'girl7', 7: 'girl8', 8: 'girl4' };
const STAT_MAP = {
  防禦: 'combat-defence',
  防禦: 'combat-defence',
  備揍防禦: 'combat-defence',
  攻擊: 'combat-attack',
  爆發: 'combat-attack-dice',
  攻擊爆擊: 'combat-attack-dice',
  攻擊骰子: 'combat-attack-dice',
  暗器攻擊: 'combat-weapon',
  暗器威力: 'combat-weapon',
  暗器爆發: 'combat-weapon-dice',
  暗器爆擊: 'combat-weapon-dice',
  暗器骰子: 'combat-weapon-dice',
  暗器命中補正: 'combat-weapon-hit',
  絕招: 'combat-ultimate',
  血量: 'hp',
  抗毒: 'poison-resistance',
  抗麻: 'paralysis-resistance',
  毒素累積: 'poison-value',
  毒藥累積: 'poison-value',
  麻痺累積: 'paralysis-value'
};
const CACHE_PRIORITY = [
  ['MISC', 'SPECIAL', 'EFFECT', 'FLAG', 'TERM', 'SKILL'],
  ['TALENT'],
  ['BOOK', 'EQUIP'],
  ['GROUP'],
  ['MISSION', 'TRIGGER', 'POSITION', 'CONDITION', 'SWITCH', 'DICE', 'COMBAT', 'BATTLE'],
  ['SCRIPT']
];

// Helper: 格式化Log
function writeLog(level, msg, errMsg = null) {
  switch (level) {
    case 'info':
      console.log(`\u001b[1;32m${msg}\u001b[0m`);
      break;
    case 'log':
      console.log(msg);
      break;
    case 'warn':
      console.warn(`\u001b[1;33m${msg}\u001b[0m`);
      break;
    case 'error':
      console.error(`\u001b[1;31m${msg}\u001b[0m`, errMsg ? `\n${errMsg}` : '');
      break;
  }
}

// Helper: 除去UID及(如果有).json副檔名
function removeUid(name) {
  return name.replace(REGEX_UID, '');
}

// Helper: 除去.json.lua副檔名
function removeExt(fileName) {
  return fileName.replace(REGEX_EXT, '');
}

// Helper: 讀取Json清單
async function getJsonList(dir) {
  try {
    const files = await readdir(path.join(GAME_PATH, 'ExportData', dir));
    const jsons = files.filter((file) => path.extname(file).toLowerCase() == '.json');

    if (jsons.length === 0) {
      writeLog('warn', `No json files found with the folder "${dir}".`);
      return [];
    }
    return jsons;
  } catch (err) {
    writeLog('error', `Reading files from folder "${dir}" failed.`, err.message);
    return [];
  }
}

// Helper: 讀取Json檔案
async function loadJson(filePath, errMsg = true) {
  try {
    const dataRaw = await readFile(filePath, 'utf-8');
    return JSON.parse(dataRaw);
  } catch (err) {
    if (errMsg) writeLog('error', `Loading or parsing "${path.basename(filePath)}" failed.`, err.message);
  }
}

// Helper: 讀取遊戲輸出Json檔案
async function getGameJson(fileName, dir) {
  return await loadJson(path.join(GAME_PATH, 'ExportData', dir, `${removeExt(fileName)}.json`));
}

// Helper: 讀取自訂資料Json檔案
async function getDataJson(fileName, dir = 'custom', nullable = true) {
  return (await loadJson(path.join(DATA_PATH, dir, `${fileName}.json`), !nullable)) ?? (nullable ? {} : null);
}

// Helper: 建立缺少的資料夾
async function createFolder(dir) {
  const dirPath = path.join(DATA_PATH, dir);
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (err) {
    writeLog('error', `Creating folder "${dir}" failed.`, err.message);
  }
}

// Helper: 輸出Json檔案
async function exportJson(data, fileName, dir = '', minify = false, log = true) {
  const filePath = path.join(DATA_PATH, dir, `${fileName}.json`);
  try {
    await createFolder(dir);
    await writeFile(filePath, JSON.stringify(data, null, minify ? 0 : 2));
    if (log) writeLog('info', `"${fileName}" exported successfully!`);
  } catch (err) {
    writeLog('error', `"${fileName}" exported failed.`, err.message);
  }
}

// Helper: 檢查Json讀取成功
function isValidJson(json, name, skippable = true) {
  if (!json) {
    if (skippable) writeLog('warn', `"${name}" skipped.`);
    else writeLog('error', `Reading "${name}" failed.`);
    return false;
  }
  return true;
}

// Helper: 強制解析
async function executeDirectly(parseFn, _, doUpdate) {
  await parseFn(doUpdate);
}

// Helper: 非強制解析
async function executeOptionally(parseFn, type, doUpdate) {
  // 再次檢查
  if (CACHE_FULFILL[type]) return;

  if (!doUpdate) {
    // 嘗試讀取檔案
    const data = await getDataJson(type.toLowerCase(), '', false);
    if (data) {
      CACHE[type] = data;
      CACHE_FULFILL[type] = true;

      // 確認一併讀取完整版
      const dataFull = await getDataJson(`${type.toLowerCase()}Full`, '', true);
      if (Object.keys(dataFull).length > 0) {
        CACHE[`${type}_FULL`] = dataFull;
      }
      return;
    }
  }
  // 指定更新資料或讀不到檔案
  await parseFn();
}

// Helper: 預載全域Cache變數
async function loadCache(inputTypes, doUpdate = false) {
  // 確認是否已有完整Cache
  const pendingTypes = new Set(inputTypes.filter((t) => !CACHE_FULFILL[t]));
  if (pendingTypes.size === 0) return;

  // 函式對照 [解析策略, 解析函式]
  const fnSetMap = {
    // 強制解析
    TERM: [executeDirectly, parseTerm],
    MISC: [executeDirectly, parseMisc],
    SPECIAL: [executeDirectly, parseSpecial],
    TALENT: [executeDirectly, parseTalent],
    BOOK: [executeDirectly, parseBook],
    EQUIP: [executeDirectly, parseEquip],
    EFFECT: [executeDirectly, parseCombatEffect],
    // 非強制解析
    SKILL: [executeOptionally, parseBattleSkill],
    FLAG: [executeOptionally, parseFlag],
    GROUP: [executeOptionally, parseStatGroup],
    MISSION: [executeOptionally, parseMission],
    TRIGGER: [executeOptionally, parseMission],
    POSITION: [executeOptionally, parsePosition],
    CONDITION: [executeOptionally, parseCondition],
    SWITCH: [executeOptionally, parseSwitch],
    DICE: [executeOptionally, parseDice],
    COMBAT: [executeOptionally, parseCombat],
    BATTLE: [executeOptionally, parseBattle],
    SCRIPT: [executeOptionally, parseScript]
  };

  // 取得Cache程序
  const process = async (type) => {
    const fnSet = fnSetMap[type];
    if (fnSet) {
      const [strategyFn, parseFn] = fnSet;
      await strategyFn(parseFn, type, doUpdate);
    }
  };

  // 並行處理
  const typesText = [...pendingTypes].join('", "');
  writeLog('log', `Loading cache of "${typesText}"...`);
  for (const types of CACHE_PRIORITY) {
    const filteredTypes = types.filter((t) => pendingTypes.has(t));
    if (filteredTypes.length > 0) await Promise.all(filteredTypes.map(process));
  }
  writeLog('log', `Cache of "${typesText}" load completed.`);
}

// Helper: 提取主要角色
function extractMainCharacter(charId, convertAlias = true) {
  // 檢查是否為主要角色
  if (REGEX_CHAR_MAJOR.test(charId)) {
    // 特例處理
    if (charId == 'big_trainee_girl_1') {
      if (convertAlias) return 'dio1';
      return undefined;
    }
    if (charId.startsWith('big_trainee')) {
      if (convertAlias) return 'big_shock1';
      return undefined;
    }

    // 檢查額外後綴判斷是否為別名
    const match = charId.match(REGEX_CHAR_EXTRA);
    if (match) {
      if (convertAlias) return match[1];
      return undefined;
    }

    // 正常回傳本身
    return charId;
  }
  // 非主要角色
  else return undefined;
}

// Helper: 合併關聯屬性
function mergeRelation(targetRel, sourceRel) {
  // 遍歷來源
  for (const [category, items] of Object.entries(sourceRel ?? {})) {
    // 目標已有該類別則執行合併
    if (targetRel[category]) {
      for (const item of items) {
        if (!targetRel[category].includes(item)) targetRel[category].push(item);
      }
    }
    // 目標無該類別則執行拷貝
    else targetRel[category] = [...items];
  }
  return targetRel;
}

// Helper: 合併重要角色關聯屬性
function mergeCharacterRelation(rel, charId) {
  const mainCharId = extractMainCharacter(charId);
  if (mainCharId) mergeRelation(rel, { Character: [mainCharId] });
}

// Helper: 轉換比較運算符
function convertComparison(operator, inverse = false) {
  switch (operator) {
    case 'Less':
      return inverse ? '≥' : '<';
    case 'LessEqual':
      return inverse ? '>' : '≤';
    case 'Greater':
      return inverse ? '≤' : '>';
    case 'GreaterEqual':
      return inverse ? '<' : '≥';
    case 'NotEqual':
      return inverse ? '=' : '≠';
    default:
      return inverse ? '≠' : '=';
  }
}

// Helper: 轉換邏輯運算符
function convertLogic(operator, inverse = false) {
  return (operator === 'OR') === inverse ? '[*Custom.And*]' : '[*Custom.Or*]';
}

// Helper: 計算機率
function calcProbability(statment) {
  // 例外處理
  const setError = () => {
    if (statment.left.includes('~')) statment.left = `[*Custom.Random*]${statment.left}`;
  };

  // 解析範圍
  const parts = statment.left.split('~').map((s) => parseInt(s.trim(), 10));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    writeLog('warn', `Invalid range format "${statment.left}".`);
    return setError();
  }

  // 解析計算用數值
  const min = Math.min(parts[0], parts[1]);
  const max = Math.max(parts[0], parts[1]);
  const target = parseInt(statment.right, 10);
  const total = max - min + 1;

  // 無法計算
  if (total <= 0 || isNaN(target)) return setError();

  // 計算符合條件的數量
  let count = 0;
  switch (statment.symbol) {
    case '≤':
    case '<=':
      count = Math.min(max, target) - min + 1;
      break;
    case '<':
      count = Math.min(max, target - 1) - min + 1;
      break;
    case '≥':
    case '>=':
      count = max - Math.max(min, target) + 1;
      break;
    case '>':
      count = max - Math.max(min, target + 1) + 1;
      break;
    case '=':
    case '==':
      count = target >= min && target <= max ? 1 : 0;
      break;
    default:
      writeLog('warn', `Unknown operator "${statment.symbol}".`);
      return setError();
  }

  // 修正範圍外數值並回存
  statment.left = '[*Custom.Probability*]';
  statment.right = `${Math.min(100, Math.round((Math.max(0, count) / total) * 100))}%`;
  statment.symbol = ':';
}

// Helper: 格式化旗標設定
function handleFlagStatement(flagId, val, script, symbol = '=', isEffect = false) {
  // 初始化變數
  const statment = { left: `[*Label.Flag,${flagId}.0*]`, right: val, symbol, brackets: { left: '[%', right: '%]' } };

  // Helper: 調整旗標格式
  const formatFlag = (flagItem, index) => {
    const type = flagItem.type ?? '';
    statment.left = `[*Label.${type}Flag,${flagId}.${index}*]`;

    // 效果不加括號
    if (isEffect) statment.brackets = { left: '', right: '' };

    // 判斷旗標是否設定對應值
    if (flagItem?.value?.[val]) {
      statment.right = `[*Flag.${flagId}.${index}.${val}*]`;

      // 對應遊戲中幾個在Flag預設為0時把Flag=1寫成Flag+1的狀況
      if (symbol == '+' && val == 1) statment.symbol = '=';
      if (symbol == '+' && val == -1) statment.symbol = '=';
    }
  };

  // 取得旗標緩存
  const flagItems = CACHE.FLAG?.[flagId]?.data;
  if (flagItems && flagItems.length > 0) {
    // 通用設定
    formatFlag(flagItems[0], 0);

    // 確認劇本特殊設定
    if (script) {
      for (let i = 0; i < flagItems.length; i++) {
        if (flagItems[i].script.includes(script)) {
          formatFlag(flagItems[i], i);
          break;
        }
      }
    }
    // 劇本特殊設定未確認標記
    else if (flagItems.length > 1) {
      statment.left = `[*Flag.${flagId}.X*]`;
      statment.right = `[*Flag.${flagId}.X.${val}*]`;
    }
  } else {
    writeLog('warn', `Flag "${flagId}" in script "${script ?? 'none'}" data not found.`);
  }

  // 回傳內容
  statment.text = `${statment.brackets.left}${statment.left}${statment.symbol}${statment.right}${statment.brackets.right}`;
  return statment;
}

// Helper: 組合判斷式
function handleStatement(var1, operator, var2, script, inverse = false) {
  // 初始化變數
  const val = var2?.name ?? var2;
  const symbol = convertComparison(operator, inverse);
  let statment = { left: var1.name, right: val, symbol, brackets: { left: '[%', right: '%]' }, rel: {} };

  // 特殊格式判斷
  switch (var1.type) {
    case 'Random':
      calcProbability(statment);
      break;
    case 'Condition':
      statment.right = `[*Flag.Match.${val}*]`;
      break;
    case 'Develop':
    case 'Book':
    case 'Achievement':
      if ((['≥', '='].includes(symbol) && val == 1) || (symbol == '>' && val == 0)) {
        statment.symbol = '=';
        statment.right = `[*Flag.Own.1*]`;
      } else if ((['≤', '='].includes(symbol) && val == 0) || (symbol == '<' && val == 1)) {
        statment.symbol = '=';
        statment.right = `[*Flag.Own.0*]`;
      }
      break;
    case 'Flag':
      statment = handleFlagStatement(var1?.flag, val, script, symbol);
      statment.rel = {};
      break;
    case 'PlayerStat':
      // 判斷屬性值是否為心上人
      if (var1.name == '[*Label.Stat,lover*]') {
        statment.right = `[*PlayerInfo.Lover.${val}*]`;

        // 增加關聯角色
        const loverId = LOVER_MAP[val];
        if (loverId) {
          statment.right = `[*Label.Character,${loverId}*]`;
          mergeRelation(statment.rel, { Character: [loverId] });
        }
      }
      break;
  }

  // 合併關聯資料
  mergeRelation(statment.rel, var1.rel);
  mergeRelation(statment.rel, var2?.rel ?? {});

  // 回傳內容
  statment.text = `${statment.brackets.left}${statment.left}${statment.symbol}${statment.right}${statment.brackets.right}`;
  return statment;
}

// Helper: 組合條件式
async function getCondition(conditionData, name, inverse = false) {
  // 初始化參數
  const rules = [];
  const rels = [];

  // 解析條件並組合
  for (const item of conditionData._items ?? conditionData ?? []) {
    const rule = [];
    const rel = {};
    for (const subItem of item._items ?? []) {
      const var1 = await getStatGroup(subItem._value1._name);
      const var2 = await getStatGroup(subItem._value2._name);
      const statment = handleStatement(var1, subItem._compareOp, var2, null, inverse);
      rule.push(statment.text);
      mergeRelation(rel, statment.rel);
    }

    if (rule.length > 0) {
      rules.push(rule.join(convertLogic(item._logicOp, inverse)));
      rels.push(rel);
    } else writeLog('warn', `1 rule of Condition "${name}" skipped.`);
  }

  // 無效條件
  if (rules.length === 0) return { name: `[*Custom.InvalidCondition,${name}*]`, rel: {} };

  // 複數條件(遊戲中理論上沒有)
  if (rules.length > 1) writeLog('warn', `Multi-Condition on "${name}".`);

  // 回傳第一個條件式
  return { name: rules[0], rel: rels[0] ?? {} };
}

// Helper: 取得屬性值變數的Key
function getStatKey(type, statItem) {
  switch (type) {
    case '好感度':
      return statItem._relationship?._name;
    case '風雲史':
      return statItem._libraryAchieve?._name;
    case '技能':
    case '天賦':
      return (statItem._talentData ?? statItem._talent)?._name;
    case '遊戲時間':
      return statItem._gameTime?._name;
    case '書籍':
    case '秘笈等級':
      return statItem._book?._name;
    case '常數':
      return statItem._constant;
    case '貴重品':
      return statItem._specialItem?._name;
    case '已開發項目':
    case '開發項目等級':
      return statItem._upgradeItemData?._name;
    case '旗標':
      return statItem._flag?._name;
    case '條件設定':
      return statItem._condition?._name;
    case '角色數值':
      return statItem._stat?._name;
    case '隨機值':
      return `${statItem._randomMin}~${statItem._randomMax}`;
    case '雜物':
      return statItem._misc?._name;
    case '數值群組':
      return statItem._statGroup?._name;
    default:
      return null;
  }
}

// Helper: 嘗試取得Id (Misc/Special/Book/Talent/Equip)
async function queryItemId(key, ref, dir) {
  // 嘗試取得Cache
  let id = ref?.[key];
  if (id) return id;

  // 無Cache嘗試讀檔
  const data = await getGameJson(key, dir);
  id = data?._id ?? data?._key ?? data.Value;
  if (id) return (ref[key] = id);

  writeLog('warn', `Querying id of "${key}" failed.`);
  return 'Unknown';
}

// Helper: 轉換名稱格式
function toKebab(str) {
  return str.replace(REGEX_CAMEL_KEBAB, '$1-$2').replace(REGEX_UNDERSCORE, '-').toLowerCase();
}

// 取得屬性值變數
async function getStat(statItem) {
  // 判斷類別並取得鍵值
  const type = statItem._checkType ?? statItem._type ?? '角色數值';
  const key = getStatKey(type, statItem);
  const statId = key ? `${type}:${key}` : null;

  // 取得Cache或解析內容
  const result =
    CACHE.STAT[statId] ??
    (await (async () => {
      try {
        switch (type) {
          case '好感度': {
            const subId = key.toLowerCase().replace(REGEX_RELATIONSHIP, '$1');
            return { name: `[*Label.Relationship,${subId}*]`, type: 'Relationship', rel: { Character: [subId] } };
          }
          case '風雲史': {
            const subId = removeUid(key);
            return { name: `[*Label.Achievement,${subId}*]`, type: 'Achievement', rel: { Achievement: [subId] } };
          }
          case '天賦':
          case '技能': {
            const subId = await queryItemId(key, REF_MAP.TALENT, 'PlayerTalentData');
            return { name: `[*Label.Talent,${subId}*]`, type: 'Talent', rel: { Talent: [subId] } };
          }
          case '遊戲時間': {
            const subId = removeUid(key);

            // 遊戲目前時間
            if (subId === 'PlayerGameTime') {
              return { name: `[*Custom.GameTime*]`, type: 'GameTime' };
            }

            // 時間常數
            if (REGEX_TIME.test(subId)) {
              const data = await getGameJson(key, 'GameTimeData');
              const { Year, Month, Stage } = data?.GameTime ?? { Year: 0, Month: 0, Stage: 0 };
              return { name: `[*Custom.GameTimeText,${Year},${Month},${STAGE_MAP[Stage] ?? '0'}*]`, type: 'TimeData' };
            }

            // 時間變數
            CACHE.TIME[subId] = {};
            return { name: `[*Label.Time,${subId}*]`, type: 'TimeVar', rel: { Time: [subId] } };
          }
          case '書籍': {
            const subId = await queryItemId(key, REF_MAP.BOOK, 'Book');
            return { name: `[*Label.Book,${subId}*]`, type: 'Book', rel: { Book: [subId] } };
          }
          case '秘笈等級': {
            const subId = await queryItemId(key, REF_MAP.BOOK, 'Book');
            return { name: `[*Label.Book,${subId}*]LV`, type: 'BookLevel', rel: { Book: [subId] } };
          }
          case '常數':
            return { name: key, type: 'Constant' };
          case '貴重品': {
            const subId = await queryItemId(key, REF_MAP.SPECIAL, 'SpecialItem');
            return { name: `[*Label.Special,${subId}*]`, type: 'Special', rel: { Special: [subId] } };
          }
          case '已開發項目': {
            const subId = await queryItemId(key, REF_MAP.EQUIP, 'UpgradeItemData');
            return { name: `[*Label.Equip,${subId}*]`, type: 'Equip', rel: { Equip: [subId] } };
          }
          case '開發項目等級': {
            const subId = await queryItemId(key, REF_MAP.EQUIP, 'UpgradeItemData');
            return { name: `[*Label.Equip,${subId}*]LV`, type: 'EquipLevel', rel: { Equip: [subId] } };
          }
          case '旗標': {
            const subId = removeUid(key);
            return { name: `[*Label.Flag,${subId}*]`, type: 'Flag', flag: subId, rel: { Flag: [subId] } };
          }
          case '條件設定': {
            const data = await getGameJson(key, 'ConditionResultData');
            if (!isValidJson(data, key)) {
              return { name: `[*Custom.InvalidCondition,${key}*]`, type: 'Condition', rel: {} };
            }
            const condition = await getCondition(data, key);
            return { name: `[*Custom.Condition*][${condition.name.replace(REGEX_CONDITION, '$1')}]`, type: 'Condition', rel: condition.rel };
          }
          case '角色數值': {
            const subId = removeUid(key);

            // 非主角屬性值
            const matched = subId.match(REGEX_ENEMY_STAT);
            if (matched) {
              return { name: `[*Label.Enemy,${matched[1]}*][*PlayerStat.${toKebab(matched[2])}*]`, type: 'EnemyStat' };
            }

            // 主角屬性值
            const statName = toKebab(subId.replace(REGEX_STAT_PREFIX, ''));
            return { name: `[*Label.Stat,${STAT_MAP[statName] ?? statName}*]`, type: 'PlayerStat' };
          }
          case '隨機值':
            return { name: key, type: 'Random' };
          case '雜物': {
            const subId = await queryItemId(key, REF_MAP.MISC, 'Misc');
            return { name: `[*Label.Misc,${subId}*]`, type: 'Misc', rel: { Misc: [subId] } };
          }
          case '數值群組':
            return await getStatGroup(key);
          default:
            writeLog('error', `Parsing statVar type "${type}" unknown.`);
            return { name: type, type: 'UnknownType' };
        }
      } catch (err) {
        writeLog('error', `Parsing statVar type "${type}" failed.`, err.stack);
        return { name: `Error(${type})`, type: 'Error' };
      }
    })());

  // 回存Cache並回傳
  if (statId) CACHE.STAT[statId] ??= result;
  return result;
}

// 取得屬性值變數群組
async function getStatGroup(fileName) {
  // 判斷是否有Cache
  const groupId = removeUid(fileName);
  if (CACHE.GROUP[groupId]) return CACHE.GROUP[groupId];

  // 讀取屬性值變數群組資料
  const data = await getGameJson(fileName, 'StatGroupVariable');
  if (!isValidJson(data, groupId)) return { name: `Error(${groupId})`, type: 'Error' };

  // 初始化並記錄屬性值變數群組資料
  const groupType = data._groupType;
  const stats = [];
  const names = [];
  const result = { rel: {} };

  // 取得屬性值資料
  for (const value of data._value) {
    const stat = await getStat(value);
    stats.push(stat);
    names.push(stat.name);
    mergeRelation(result.rel, stat.rel);
  }

  // 判斷是否為群組
  if (names.length > 1) {
    switch (groupType) {
      case 'Sum':
        result.name = names.join('+');
        break;
      case 'Max':
      case 'Min':
        result.name = `[*Custom.${groupType}*](${names.join(',')})`;
        break;
      case 'Multiply':
        result.name = names.join('×');
        break;
      default:
        writeLog('warn', `Unknown StatGroup type: "${groupType}".`);
        result.name = names.join(',');
    }
    result.type = 'Group';
  } else if (names.length == 1) {
    result.name = names[0];
    result.type = stats[0].type;
    const flag = stats[0]?.flag;
    if (flag) result.flag = flag;
  } else {
    writeLog('warn', `"${groupId}" skipped (empty group).`);
    return { name: `Error(${groupId})`, type: 'Error', rel: {} };
  }

  // 儲存內容並回傳
  CACHE.GROUP[groupId] ??= result;
  return result;
}

// 解析用詞資料
export async function parseTerm(doExport = true) {
  // Helper: 深層賦值
  const safeAssign = (root, keys, value) => {
    let current = root;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      current[k] ??= {};
      current = current[k];
    }
    current[keys[keys.length - 1]] = value;
  };

  // Regex常數
  const regexNewLine = /\s*\n\s*/gm;
  const regexVoice = /{size=(\d+)}(.*?){\/size}/gm;
  const regexParamN = /{(\d+):N0}/g;
  const regexParamP = /{(\d+):P0}/g;
  const libraryMap = { 1: 'Dead', 2: 'End', 3: 'Achievement' };

  // 讀取資料
  const [data, optionCustom] = await Promise.all([getGameJson('zh-tw', '../Localizations'), getDataJson('option')]);
  if (!isValidJson(data, 'zh-tw', false)) return;

  // 初始化變數
  const dialog = { Story: {} };
  const option = { Story: {} };
  const term = { System: {}, Facility: { Name: {} } };

  // 遍歷項目並處理
  for (const [key, val] of Object.entries(data)) {
    const keys = key.split('/');
    const category = keys[0];
    const type = keys[1] ?? '';
    const id = keys[keys.length - 1];

    switch (category) {
      case 'System':
        if (keys.length >= 3) {
          if (['Start'].includes(type)) break;
          safeAssign(term, [category, type, id], val);
        } else {
          safeAssign(term, [category, id], val);
        }
        break;
      case 'Special':
      case 'Position':
      case 'PlayerTalent':
      case 'PlayerInfo':
      case 'Misc':
      case 'MapPosition':
      case 'Equip':
      case 'CombatCharacter':
      case 'Book':
      case 'BattleSkill':
      case 'Middle':
        if (keys.length >= 3) {
          if (['Dialog', 'Format', 'Brother1'].includes(type)) break;
          safeAssign(term, [category, type, id], val);
        } else writeLog('warn', `"${category}/${id}" has skipped (insufficient depth).`);
        break;
      case 'CombatSkill':
        if (keys.length >= 3) {
          safeAssign(term, [category, type, id], val);
          if (type == 'Name') CACHE.TERM.COMBAT_SKILL[id] = val;
        } else writeLog('warn', `"${category}/${id}" has skipped (insufficient depth).`);
        break;
      case 'Library':
        if (keys.length >= 3) {
          safeAssign(term, [category, type, id], val);
          if (type == 'Title') CACHE[libraryMap[id[0]].toUpperCase()][id] = {};
        } else writeLog('warn', `"${category}/${id}" has skipped (insufficient depth).`);
        break;
      case 'StatLevel':
      case 'PlayerStat':
      case 'PlayerStatDesc':
      case 'MiddleMenu':
      case 'CombatAction':
      case 'CombatInfo':
      case 'CharacterTitle':
      case 'CharacterIntro0':
      case 'CharacterIntro1':
      case 'CharacterIntro2':
      case 'CharacterIntro3':
      case 'CharacterIntro4':
      case 'MartialStatDisplay':
      case 'MartialCondition':
      case 'DevelopRefund':
      case 'DevelopCondition':
      case 'Develop':
        safeAssign(term, [category, id], val);
        break;
      case 'UpgradeItemRelationDesc':
        safeAssign(term, [category, id], val.replace(regexParamN, '{$1}').replace(regexParamP, '{$1}%'));
        break;
      case 'Character':
        safeAssign(term, [category, id.toLowerCase()], val);
        CACHE.TERM.CHARACTER[id] = val;
        break;
      case 'EnemyTeam':
        safeAssign(term, [category, id.toLowerCase()], val);
        CACHE.TERM.TEAM[id] = val;
        break;
      case 'Facility':
        if (keys[1] === 'Name') term.Facility.Name[id] = val;
        break;
      case 'Story': {
        const text = val.replace(regexNewLine, '').replace(regexVoice, '([*Custom.Voice$1*])$2');
        if (id.startsWith('O_')) option.Story[id] = { _: text, short: optionCustom?.Story?.[id]?.short ?? text };
        else dialog.Story[id] = text;
        break;
      }
      case 'LegendInfo':
      case 'CombatTalking':
      case 'BattleDialog':
        safeAssign(dialog, [category, id], val.replace(regexNewLine, ''));
        break;
    }
  }
  writeLog('log', `Localizations parsed successfully!`);
  CACHE_FULFILL.TERM = true;

  // 處理角色
  REF_MAP.CHARACTER = {};
  for (const key in CACHE.TERM.CHARACTER) {
    const majorNpc = extractMainCharacter(key, false);
    if (majorNpc) {
      // 建立反向參照及Cache
      REF_MAP.CHARACTER[CACHE.TERM.CHARACTER[key]] ??= key;
      CACHE.CHARACTER[majorNpc] ??= {};
    }
  }
  // 補充缺失角色
  CACHE.CHARACTER.special213 = {};
  CACHE.CHARACTER.special214 = {};
  CACHE.CHARACTER.special215 = {};

  // 並行輸出結果
  if (doExport)
    await Promise.all([
      exportJson(term, 'term'),
      exportJson(dialog, 'dialog'),
      exportJson(option, 'option'),
      exportJson(CACHE.CHARACTER, 'character'),
      exportJson(CACHE.DEAD, 'dead'),
      exportJson(CACHE.ACHIEVEMENT, 'achievement'),
      exportJson(CACHE.END, 'end')
    ]);
}

// 解析旗標資料
export async function parseFlag() {
  // 讀取資料
  const [custom, files] = await Promise.all([getDataJson('flagCustom'), getJsonList('FlagData')]);
  if (files.length == 0) return;

  // 初始化
  const result = {};
  const regexNewLine = /[\r\n]+/g;
  const emptyFlagItem = { script: [], name: '', value: { 0: '[*Custom.False*]', 1: '[*Custom.True*]' }, desc: '' };

  // 主要處理流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'FlagData');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const id = removeUid(file);
      const note = (data._devNote || '').trim();
      result[id] = { data: [], init: data._default };
      custom[id] = { ori: note.split(regexNewLine)[0] || id, ref: note.replace(regexNewLine, '｜'), data: custom?.[id]?.data ?? [emptyFlagItem] };

      // 嘗試載入客製化資料
      (custom?.[id]?.data ?? []).forEach((flagItem, index) => {
        const valueName = {};
        for (const key in flagItem.value ?? {}) {
          valueName[key] = `[*Flag.${id}.${index}.${key}*]`;
        }
        result[id].data.push({ script: flagItem.script, value: valueName, type: flagItem.type });
      });

      // 無客製化則使用基本資料
      if (result[id].data.length === 0) {
        result[id].data.push({ script: [], value: { 0: `[*Flag.${id}.0.0*]`, 1: `[*Flag.${id}.0.1*]` } });
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err);
    }
  };

  // 並行處理所有檔案
  await Promise.all(files.map(process));
  writeLog('log', '"FlagData" parsed successfully!');

  // 並行輸出結果
  await Promise.all([exportJson(result, 'flag'), exportJson(custom, 'flagCustom')]);
  CACHE.FLAG = result;
  CACHE_FULFILL.FLAG = true;
}

// 解析雜物資料
export async function parseMisc(doExport = true) {
  // 取得檔案清單
  const files = await getJsonList('Misc');
  if (files.length === 0) return;

  // 初始化
  const result = {};
  const ref = {};

  // 主要處理流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'Misc');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const id = data._id;
      result[id] = { cost: data._cost };
      ref[removeExt(file)] = id;
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err);
    }
  };

  // 並行處理所有檔案
  await Promise.all(files.map(process));
  writeLog('log', '"Misc" parsed successfully!');

  // 輸出結果
  if (doExport) await exportJson(result, 'misc');
  CACHE.MISC = result;
  CACHE_FULFILL.MISC = true;
  REF_MAP.MISC = ref;
}

// 解析寶物/貴重品資料
export async function parseSpecial(doExport = true) {
  // 取得檔案清單
  const files = await getJsonList('SpecialItem');
  if (files.length === 0) return;

  // 初始化
  const result = {};
  const ref = {};

  // 主要處理流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'SpecialItem');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const id = data._id;
      result[id] = { cost: data._cost };
      ref[removeExt(file)] = id;
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err);
    }
  };

  // 並行處理所有檔案
  await Promise.all(files.map(process));
  writeLog('log', '"Special" parsed successfully!');

  // 輸出結果
  if (doExport) await exportJson(result, 'special');
  CACHE.SPECIAL = result;
  CACHE_FULFILL.SPECIAL = true;
  REF_MAP.SPECIAL = ref;
}

// 解析決鬥效果
export async function parseCombatEffect(doExport = true) {
  // 取得檔案清單
  const files = await getJsonList('CombatStateEffectScriptable');
  if (files.length === 0) return;

  // 初始化
  const result = {};
  const typeMap = { 常駐: 'Resident', 倒數效果: 'Countdown', 次數: 'Count', 倒數觸發: 'CountdownTrigger' };

  // Helper: 處理子Effect
  const addEffectUnit = async (skillSet, file) => {
    try {
      // 讀取Unit資料
      const unitData = await getGameJson(file, 'CombatStateEffectUnitScriptable');
      if (!isValidJson(unitData, file)) return;
      const items = unitData?._item?.[0]?._effect ? unitData._item : [unitData];

      for (const item of items) {
        if (!item._effect) continue;

        // 讀取效果資料
        const effectFile = item._effect._name;
        const effectData = await getGameJson(effectFile, 'CombatStateEffectScriptable');
        if (!isValidJson(effectData, effectFile)) continue;

        // 紀錄效果資料
        skillSet.add(effectData._key);
        for (const unit of effectData._units ?? []) {
          if (unit._type.includes('Effect')) {
            await addEffectUnit(skillSet, unit._name);
          }
        }
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err);
    }
  };

  // 主要處理流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'CombatStateEffectScriptable');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const id = data._key;
      result[id] = { state: data._stateType, type: typeMap[data._type] ?? 'Unknown', plural: data._plural, noRepeat: data._noRepeat, round: data._rounds, show: data._show, rel: {} };

      // 記錄效果
      const skillSet = new Set();
      for (const unit of data._units ?? []) {
        if (unit._type.includes('Effect')) {
          await addEffectUnit(skillSet, unit._name);
        }
      }
      result[id].rel.post = { Effect: Array.from(skillSet) };
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err);
    }
  };

  // 並行處理所有檔案
  await Promise.all(files.map(process));
  writeLog('log', '"Combat Effect" parsed successfully!');

  // 輸出結果
  if (doExport) await exportJson(result, 'effect');
  CACHE.EFFECT = result;
  CACHE_FULFILL.EFFECT = true;
}

// 解析天賦/技能資料
export async function parseTalent(doExport = true) {
  // 取得檔案清單
  const [files] = await Promise.all([getJsonList('PlayerTalentData'), loadCache(['EFFECT'])]);
  if (files.length === 0) return;

  // 初始化
  const result = {};
  const ref = {};

  // 主要處理流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'PlayerTalentData');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const id = data._id;
      result[id] = { level: data._displayLevel ? data._maxLevel : 0, skills: [], low: [], rel: { post: { Effect: [] } } };
      ref[removeExt(file)] = id;

      // 決鬥技能
      if (data._combatSkill) {
        for (let i = 0; i <= result[id].level; i++) {
          let skillId;
          if (i === 0) {
            if (data._displayLevel) {
              result[id].skills[0] = [];
              continue;
            } else {
              skillId = data._combatSkillKey;
            }
          } else {
            skillId = `${data._combatSkillKey}_${i}`;
          }
          result[id].skills[i] = [skillId];
          result[id].rel.post.Effect.push(skillId);

          // 紀錄後續效果
          const relSkills = CACHE.EFFECT?.[skillId]?.rel?.post?.Effect;
          if (relSkills) {
            result[id].skills[i].push(...relSkills);
            result[id].rel.post.Effect.push(...relSkills);
          }
        }
      }

      // 紀錄下位技能
      for (const item of data._lowLevelTalent ?? []) {
        const lowId = await queryItemId(item._name, ref, 'PlayerTalentData');
        result[id].low.push(lowId);
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err);
    }
  };

  // 並行處理所有檔案
  await Promise.all(files.map(process));
  writeLog('log', '"Talent" parsed successfully!');

  // 輸出結果
  if (doExport) await exportJson(result, 'talent');
  CACHE.TALENT = result;
  CACHE_FULFILL.TALENT = true;
  REF_MAP.TALENT = ref;
}

// Helper: 銀行家捨入法 (四捨六入五成雙)
function bankersRound(num) {
  const m = num % 1;
  if (m === 0.5 || m === -0.5) {
    const floorStr = Math.floor(num);
    return floorStr % 2 === 0 ? floorStr : floorStr + 1;
  }
  return Math.round(num);
}

// Helper: 泛用型曲線解析器
function evaluateCurve(curve, time) {
  if (!curve || curve.length === 0) return 0;
  if (time <= curve[0].time) return curve[0].value;
  if (time >= curve[curve.length - 1].time) return curve[curve.length - 1].value;

  for (let i = 0; i < curve.length - 1; i++) {
    let k0 = curve[i];
    let k1 = curve[i + 1];

    if (time >= k0.time && time < k1.time) {
      if (k0.outTangent === 'Infinity' || k1.inTangent === 'Infinity') {
        return k0.value;
      }

      let dt = k1.time - k0.time;
      let t_norm = (time - k0.time) / dt;

      let t2 = t_norm * t_norm;
      let t3 = t2 * t_norm;

      let m0 = k0.outTangent * dt;
      let m1 = k1.inTangent * dt;

      let h00 = 2 * t3 - 3 * t2 + 1;
      let h10 = t3 - 2 * t2 + t_norm;
      let h01 = -2 * t3 + 3 * t2;
      let h11 = t3 - t2;

      return h00 * k0.value + h10 * m0 + h01 * k1.value + h11 * m1;
    }
  }
  return 0;
}

// 解析秘笈/書籍資料 (可使用天賦/雜物Cache)
export async function parseBook(doExport = true) {
  // 取得檔案清單
  const files = await getJsonList('Book');
  if (files.length === 0) return;

  // 初始化
  const result = {};
  const ref = {};
  const typeMap = { 特殊: 'Etc', 內功: 'Internal', 拳掌: 'Fist', 刀劍: 'Sword', 暗器: 'Weapon' };

  // Helper: 產生完整的各等級提升數值陣列
  const generateLevelData = (target, statName, curveData, maxLevel) => {
    let currentTotal = 0;

    // 等級從 1 開始遍歷到上限
    for (let level = 1; level <= maxLevel; level++) {
      const time = level / maxLevel;
      const rawValue = evaluateCurve(curveData, time);
      const roundedValue = bankersRound(rawValue);
      const gain = roundedValue - currentTotal;

      // 紀錄提升量
      if (gain !== 0) {
        const sign = gain < 0 ? '' : '+';
        target[level - 1].effect.unshift(`${statName}${sign}${gain}`);
      }

      // 更新當前總和供下一輪計算
      currentTotal = roundedValue;
    }
  };

  // 主要處理流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'Book');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const id = data._id;
      result[id] = { cost: data._cost, martial: data._martial, type: data._martial ? typeMap?.[data._martialType] : '', level: data._martialLevelData.length, levels: [], rel: { pre: {}, post: {} } };
      ref[removeExt(file)] = id;

      // 紀錄等級資料
      for (let i = 0; i < data._martialLevelData.length; i++) {
        const levelItem = data._martialLevelData[i];
        const levelFile = levelItem._name;
        const levelData = await getGameJson(levelFile, 'MartialLevelData');
        if (!isValidJson(levelData, levelFile)) continue;

        const conditionFile = levelData?._condition._name;
        const conditionData = await getGameJson(conditionFile, 'MartialLearnCondition');
        if (!isValidJson(conditionData, conditionFile)) continue;

        result[id].levels[i] = { point: levelData._points, condition: '', effect: [] };

        // 紀錄條件
        const rules = [];
        for (const item of conditionData._list ?? []) {
          const rule = [];
          for (const subItem of item._itemList) {
            const stat = await getStat(subItem._stat);
            const statment = `[%${stat.name}${convertComparison(subItem._compareOp)}${subItem._value}%]`;
            rule.push(statment);
            mergeRelation(result[id].rel.pre, stat.rel);
          }

          if (rule.length > 0) rules.push(rule.join('[*Custom.Or*]'));
          else writeLog('warn', `1 rule of Condition "${conditionFile}" skipped.`);
        }
        if (rules.length === 0) result[id].levels[i].condition = '[*System.NA*]';
        else result[id].levels[i].condition = rules.join('[*Custom.And*]');

        // 紀錄額外影響
        for (const statItem of levelData._levelupStats ?? []) {
          const stat = await getStat(statItem._stat);
          const val = statItem._value;
          const sign = statItem?._center ? '±' : !Number.isNaN(val) && val < 0 ? '' : '+';
          result[id].levels[i].effect.push(`${stat.name}${sign}${val}`);
          mergeRelation(result[id].rel.post, stat.rel);
        }
      }

      // 紀錄影響
      for (const statItem of data._relationStatConvert ?? []) {
        const statFile = statItem._name;
        const statData = await getGameJson(statFile, statItem._type);
        if (!isValidJson(statData, statFile)) continue;

        const stat = await getStat(statData._relationStat);

        // 等級資料重複紀錄，這邊跳過
        if (stat.type == 'Talent') continue;

        generateLevelData(result[id].levels, stat.name, statData._curve, result[id].level);
        mergeRelation(result[id].rel.post, stat.rel);
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行處理所有檔案
  await Promise.all(files.map(process));
  writeLog('log', '"Book" parsed successfully!');

  // 輸出結果
  if (doExport) await exportJson(result, 'book');
  CACHE.BOOK = result;
  CACHE_FULFILL.BOOK = true;
  REF_MAP.BOOK = ref;
}

// 解析裝備/開發項目資料 (可使用寶物Cache)
export async function parseEquip(doExport = true) {
  // 取得檔案清單
  const files = await getJsonList('UpgradeItemData');
  if (files.length === 0) return;

  // 初始化
  const result = {};
  const ref = {};
  const typeMap = { 煉丹: 'Medi', 毒術: 'Poison', 陷阱: 'Trap', 拋射: 'Projectile', 平射: 'Dart', 防具: 'Equip', 武器: 'Melee' };

  // Helper: 產生完整的各等級提升數值陣列
  const generateLevelData = (target, type, statDesc, curveData1, curveData2, maxLevel) => {
    // 判斷數值2倍率
    let multiplier2 = 1;
    if (curveData2 && curveData2.length > 0) {
      const maxValue = curveData2[curveData2.length - 1].value;
      if (maxValue > 0 && maxValue <= 1) multiplier2 = 100;
    }

    // 修復最終值進位
    if (curveData1.length > 0) {
      const maxValue = curveData1[curveData1.length - 1].value;
      if (maxValue == 0.5) curveData1[curveData1.length - 1].value = 0.501;
    }

    // 等級從 1 開始遍歷到上限
    for (let level = 1; level <= maxLevel; level++) {
      const time = level / maxLevel;
      const rawValue1 = evaluateCurve(curveData1, time);
      const rawValue2 = curveData2 ? evaluateCurve(curveData2, time) * multiplier2 : null;
      const roundedValue1 = bankersRound(rawValue1);
      const roundedValue2 = rawValue2 ? bankersRound(rawValue2) : null;

      // 紀錄提升量
      target[level - 1][type].push(`[*UpgradeItemRelationDesc.${statDesc},${roundedValue1}${roundedValue2 !== null ? `,${roundedValue2}` : ''}*]`);
    }
  };

  // 主要處理流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'UpgradeItemData');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const id = data._key;
      result[id] = {
        type: typeMap[data._itemType] ?? '',
        faction: data._requiredSectlevel,
        cost: data._costMoney,
        level: data._upgradeLevels.length,
        levels: [],
        evolution: [],
        rel: { pre: {}, post: {} }
      };
      ref[removeExt(file)] = id;

      // 記錄等級資料
      for (const levelItem of data._upgradeLevels ?? []) {
        result[id].levels.push({ point: levelItem._levelPoints, combat: [], battle: [], effect: [] });
      }

      // 記錄影響
      for (const relItem of data._combatRelationItem ?? []) {
        const relFile1 = relItem._statConvert[0]._name;
        const relData1 = await getGameJson(relFile1, 'UpgradeItemStatConvertData');
        if (!isValidJson(relData1, relFile1)) continue;

        const relFile2 = relItem._statConvert?.[1]?._name;
        const relData2 = relFile2 ? await getGameJson(relFile2, 'UpgradeItemStatConvertData') : null;

        generateLevelData(result[id].levels, 'combat', relItem._descKey, relData1._curve, relData2?._curve, result[id].level);
      }
      for (const relItem of data._battleRelationItem ?? []) {
        const relFile1 = relItem._statConvert[0]._name;
        const relData1 = await getGameJson(relFile1, 'UpgradeItemStatConvertData');
        if (!isValidJson(relData1, relFile1)) continue;

        const relFile2 = relItem._statConvert?.[1]?._name;
        const relData2 = relFile2 ? await getGameJson(relFile2, 'UpgradeItemStatConvertData') : null;

        generateLevelData(result[id].levels, 'battle', relItem._descKey, relData1._curve, relData2?._curve, result[id].level);
      }

      // 記錄生成雜物
      for (const item of data._itemModify ?? []) {
        const miscId = await queryItemId(item._item._name, REF_MAP.MISC, 'Misc');
        result[id].levels[result[id].level - 1].effect.push(`[*Label.Misc,${miscId}*]+${item._count}`);
        mergeRelation(result[id].rel.post, { Misc: [miscId] });
      }

      // 記錄重置
      if (data._resetWhenMaxLevel) result[id].levels[result[id].level - 1].effect.push('※[*Custom.ResetLevel*]');

      // 記錄可轉換開發項目
      for (const item of data._evolutionItems ?? []) {
        const evoId = await queryItemId(item._nextItem._name, ref, 'UpgradeItemData');
        const evoItem = { name: `[*Label.Equip,${evoId}*]`, condition: [] };
        mergeRelation(result[id].rel.post, { Equip: [evoId] });

        // 等級要求
        const evoLevel = item._requiredLevel;
        if (evoLevel) evoItem.condition.push(`[%[*Label.Equip,${id}*]LV≥${evoLevel}%]`);

        // 其他條件
        if (item._conditions.length) {
          const condition = await getCondition(item._conditions, file);
          evoItem.condition.push(condition.name);
          mergeRelation(result[id].rel.pre, condition.rel);
        }

        result[id].evolution.push(evoItem);
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行處理所有檔案
  await Promise.all(files.map(process));
  writeLog('log', '"Equip" parsed successfully!');

  // 輸出結果
  if (doExport) await exportJson(result, 'equip');
  CACHE.EQUIP = result;
  CACHE_FULFILL.EQUIP = true;
  REF_MAP.EQUIP = ref;
}

// 解析戰役技能
export async function parseBattleSkill(doExport = true) {
  // 取得檔案清單
  const files = await getJsonList('BattleSkillData');
  if (files.length === 0) return;

  // 初始化
  const regexCharIcon = /Sprite\/icon_(?:head|headframe)_(\w+)\.png/;
  const regexPostfix = /_\w+/;
  const result = {};

  // 主要處理流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'BattleSkillData');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const id = data._key;
      result[id] = {
        cooldown: data._cooldownTime
      };

      const matched = data._icon.match(regexCharIcon);
      if (matched) {
        result[id].character = extractMainCharacter(matched[1]);
      }
      if (!result[id].character) {
        result[id].character = extractMainCharacter(id.replace(regexPostfix, ''));
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行處理所有檔案
  await Promise.all(files.map(process));
  writeLog('log', '"BattleSkill" parsed successfully!');

  // 輸出結果
  if (doExport) await exportJson(result, 'skill');
  CACHE.SKILL = result;
  CACHE_FULFILL.SKILL = true;
}

// 解析屬性值變數群組
export async function parseStatGroup() {
  // 確認前置Cache
  const [custom] = await Promise.all([getDataJson('groupCustom'), loadCache(['FLAG'])]);

  // 初始化參數
  const files = await getJsonList('StatGroupVariable');
  const result = {};
  const group = {};

  // 解析檔案流程
  const process = async (file) => {
    try {
      const id = removeUid(file);

      // 使用客製化資料
      if (custom[id]) {
        result[id] = { type: custom[id].type, rel: custom[id].rel, name: custom[id].name };

        // 檢查是否設定別名
        if (custom[id].id) {
          result[id].name = `[*Label.GroupStat,${custom[id].id},${custom[id].type}*]`;
          group[custom[id].id] = { content: custom[id].name };
        }
      }
      // 取得解析資料
      else {
        result[id] = await getStatGroup(file);

        // 群組額外回存客製化底稿
        if (result[id].type == 'Group') custom[id] = result[id];
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行執行解析
  await Promise.all(files.map(process));
  writeLog('log', '"StatGroupVariable" parsed successfully!');

  // 並行輸出結果
  await Promise.all([exportJson(result, 'group'), exportJson(group, 'groupStat'), exportJson(custom, 'groupCustom'), exportJson(CACHE.TIME, 'time')]);
  CACHE.GROUP = result;
  CACHE.GROUPSTAT = group;
  CACHE_FULFILL.GROUP = true;
}

// 解析條件資料
export async function parseCondition() {
  // 讀取檔案清單、前置Cache
  const [files] = await Promise.all([getJsonList('ConditionResultData'), loadCache(['GROUP', 'FLAG'])]);

  // 初始化
  const result = {};

  // 主流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'ConditionResultData');
      if (!isValidJson(data, file)) return;

      // 記錄資訊
      const id = removeUid(file);
      const condition = await getCondition(data, id);
      result[id] = { name: condition.name, rel: { pre: condition.rel } };
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行處理主流程
  await Promise.all(files.map(process));
  writeLog('log', '"Condition" parsed successfully!');

  // 輸出結果
  await exportJson(result, 'condition');
  CACHE.CONDITION = result;
  CACHE_FULFILL.CONDITION = true;
}

// 解析分歧資料
export async function parseSwitch() {
  // 讀取檔案清單、前置Cache
  const [files] = await Promise.all([getJsonList('SwitchResultData'), loadCache(['GROUP', 'FLAG'])]);

  // 初始化參數
  const regexNumber = /^\d+$/;
  const result = {};

  // 主流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'SwitchResultData');
      if (!isValidJson(data, file)) return;

      // 記錄資訊
      const id = removeUid(file);
      const switchObj = { check: '', switch: [], rel: { pre: {} } };

      // 以檢定次數分歧
      if (data._useCount) {
        switchObj.check = '[*Custom.CheckTimes*]';
        for (const item of data._countItems ?? []) {
          switchObj.switch.push(`=${item._value}`);
        }
      }
      // 一般分歧條件
      else {
        const rules = [];

        // 解析分歧條件
        for (const item of data._items ?? []) {
          const rule = [];
          for (const subItem of item._items ?? []) {
            const var1 = await getStatGroup(subItem._value1._name);
            const var2 = await getStatGroup(subItem._value2._name);
            const statment = handleStatement(var1, subItem._compareOp, var2);
            rule.push(statment);
            mergeRelation(switchObj.rel.pre, statment.rel);
          }
          rules.push({ rule, op: convertLogic(item._logicOp) });
        }

        // 調整表示格式
        if (rules.length === 0) switchObj.check = `[*Custom.InvalidCheck,${id}*]`;
        // else if (rules.length == 1) switchObj.check = rules[0].rule.map(r => r.text).join(rules[0].op);
        else {
          const firstRule = rules[0].rule[0];

          // 處理機率表示
          if (rules.length == 1 && rules[0].rule.length == 1 && firstRule.left == '[*Custom.Probability*]') {
            const probability = Number(firstRule.right.slice(0, -1));
            switchObj.check = '[%[*Custom.Probability*]%]';
            switchObj.switch = [`${probability}%`, `${100 - probability}%`];
          }
          // 如果式子左邊全部相同則簡化表示
          else if (firstRule && rules.every((g) => g.rule.every((r) => r.left === firstRule.left))) {
            switchObj.check = `[%${firstRule.left}%]`;
            switchObj.switch = rules.map((g) => g.rule.map((r) => `${r.symbol == '=' && !regexNumber.test(r.right) ? '' : r.symbol}${r.right}`).join(g.op));
          }
          // 單一複雜條件
          else if (rules.length === 1) {
            switchObj.check = rules[0].rule.map((r) => r.text).join(rules[0].op);
          }
          // 完整表示所有條件式
          else {
            switchObj.check = '[*Custom.MultiCheck*]';
            switchObj.switch = rules.map((g) => g.rule.map((r) => r.text).join(g.op));
          }
        }
      }

      // 回存結果
      result[id] = switchObj;
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行處理主流程
  await Promise.all(files.map(process));
  writeLog('log', '"Switch" parsed successfully!');

  // 輸出結果
  await exportJson(result, 'switch');
  CACHE.SWITCH = result;
  CACHE_FULFILL.SWITCH = true;
}

// 解析隨機分歧資料
export async function parseDice() {
  // 讀取檔案清單、前置Cache
  const [files] = await Promise.all([getJsonList('DiceResultData'), loadCache(['GROUP', 'FLAG'])]);

  // 初始化
  const result = {};

  // 主流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'DiceResultData');
      if (!isValidJson(data, file)) return;

      // 記錄資訊
      const id = removeUid(file);
      result[id] = { bonus: [], rel: { pre: {} } };

      // 紀錄屬性加成
      for (const item of data._propertyItems ?? []) {
        const stat = await getStat(item);
        const rate = item._rate == 1.0 || item._rate == null ? '' : `×${item._rate}`;
        const op = item._negative ? '-' : '+';
        result[id].bonus.push(`[%${op}${stat.name}${rate}%]`);
        mergeRelation(result[id].rel.pre, stat.rel);
      }

      // 隨機門檻暫不紀錄
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行處理主流程
  await Promise.all(files.map(process));
  writeLog('log', '"Dice" parsed successfully!');

  // 輸出結果
  await exportJson(result, 'dice');
  CACHE.DICE = result;
  CACHE_FULFILL.DICE = true;
}

// Helper: 重建名稱草稿
function updateNameDraftItem(draft, id, ref = '', ori = id) {
  draft[id] = { ori, name: draft?.[id]?.name ?? '', ref, desc: draft?.[id]?.desc ?? '', keywords: draft?.[id]?.keywords ?? '' };
}

// 解析任務資料
export async function parseMission() {
  // 常數
  const regexTime = /\[\*Custom\.GameTime\*\]([=≥≤])\[\*Custom\.GameTimeText,(\d),(\d{1,2}),(\d)\*\]/;
  const regexMinTime = /[=≥]/;
  const regexMaxTime = /[=≤]/;
  const regexPrefix = /^.+?_/;
  const positionMap = {
    練功塔: 'Tower',
    溫泉: 'Spa',
    義田: 'Farm',
    藥鋪: 'Pharmacy',
    茶肆: 'Teashop',
    外堡: 'Fortress',
    鬧市: 'Downtown',
    神秘房子: 'Secret',
    講經堂: 'Study',
    後山: 'BackMountain',
    大門: 'Door',
    伙房: 'Kitchen',
    鍛冶場: 'Forge',
    煉丹房: 'Alchemy',
    女弟子房: 'Room2',
    弟子房: 'Room1',
    校場: 'Center',
    練武場: 'Center',
    正心堂: 'Mall'
  };

  // 讀取檔案清單、自訂資料、前置Cache
  const [missionFiles, freeFiles, triggerCustom, missionCustom, nameDraft] = await Promise.all([
    getJsonList('MissionData'),
    getJsonList('FreePositionData'),
    getDataJson('triggerCustom'),
    getDataJson('missionCustom'),
    getDataJson('missionName'),
    loadCache(['GROUP', 'FLAG'])
  ]);

  // 解析結果參數
  const trigger = {};
  const mission = {};
  nameDraft.mission ??= {};
  nameDraft.trigger ??= {};

  // 追加自訂任務及觸發
  for (const [id, item] of Object.entries(missionCustom) ?? []) {
    if (id.startsWith('CM_')) {
      mission[id] = { ...item, remark: Array.from(item?.remark ?? [], (_, i) => `[*Mission.Remark.${id}.${i}*]`), rel: { to: { Trigger: item?.trigger ?? [] } } };
      updateNameDraftItem(nameDraft.mission, id);
    }
  }
  for (const [id, item] of Object.entries(triggerCustom) ?? []) {
    if (id.startsWith('CT_')) {
      const tmpSheet = nameDraft?.trigger?.[id]?.sheet ?? '';
      trigger[id] = {
        ...item,
        remark: Array.from(item?.remark ?? [], (_, i) => `[*Trigger.Remark.${id}.${i}*]`),
        sheet: tmpSheet,
        rel: { to: { Script: item.script ? [item.script] : [] }, from: { Mission: [item.mission] } }
      };
      updateNameDraftItem(nameDraft.trigger, id);
      nameDraft.trigger[id].sheet = tmpSheet;
    }
  }

  // Helper: 生成時間字串
  const toTimeText = (timeObj) => {
    return `[*Custom.GameTimeText,${timeObj.Year},${timeObj.Month},${STAGE_MAP[timeObj.Stage] ?? '0'}*]`;
  };

  // 一般任務主流程
  const processMission = async (file) => {
    try {
      // 讀取任務資料
      const missionData = await getGameJson(file, 'MissionData');
      if (!isValidJson(missionData, file)) return;

      // 記錄任務資料
      const missionId = missionData._name;
      mission[missionId] = { trigger: [], init: missionData._initKey, remark: Array.from(missionCustom?.[missionId]?.remark ?? [], (_, i) => `[*Mission.Remark.${missionId}.${i}*]`) };
      updateNameDraftItem(nameDraft.mission, missionId, (missionData._desc ?? '').trim());

      for (const triggerItem of missionData._missions) {
        // 讀取觸發資料
        const triggerData = await getGameJson(triggerItem._name, 'MissionCheckData');
        if (!isValidJson(triggerData, triggerItem._name)) continue;

        // 記錄觸發資料
        const triggerId = triggerData._key;
        mission[missionId].trigger.push(triggerId);
        const tmpSheet = nameDraft?.trigger?.[triggerId]?.sheet ?? '';
        const triggerObj = {
          mission: missionId,
          active: triggerData._active,
          minTime: triggerCustom?.[triggerId]?.time ?? { year: '1', month: '4', stage: '1' },
          maxTime: { year: '', month: '', stage: '' },
          condition: [],
          script: triggerData._startScript,
          content: [],
          sheet: tmpSheet,
          remark: Array.from(triggerCustom?.[triggerId]?.remark ?? [], (_, i) => `[*Trigger.Remark.${triggerId}.${i}*]`),
          rel: { pre: {}, to: {}, from: { Mission: [missionId] } },
          eventFlow: triggerCustom?.[triggerId]?.eventFlow ?? undefined,
          stopFlow: triggerCustom?.[triggerId]?.stopFlow ?? [],
          flowOrder: triggerCustom?.[triggerId]?.flowOrder ?? undefined
        };
        if (triggerObj.script) mergeRelation(triggerObj.rel.to, { Script: [triggerObj.script] });
        if (!triggerObj.active) triggerObj.remark.unshift('※[*Custom.TriggerDisable*]');

        updateNameDraftItem(nameDraft.trigger, triggerId, (triggerData._desc ?? '').trim());
        nameDraft.trigger[triggerId].sheet = tmpSheet;

        // 判斷主支線
        const type = missionId == 'main' ? 'Main' : 'Sub';
        triggerObj.type = type;
        if (triggerId != missionData._initKey) triggerObj.condition.push(`[*Custom.TriggerSet,${type}*]`);

        // 確認是否有特定時間條件
        if (triggerData._dayCheck) {
          // 條件為特定時間
          if (triggerData._timeCheckType == '特定') {
            const time = triggerData._specificTime;
            triggerObj.minTime = triggerObj.maxTime = { year: time.Year.toString(), month: time.Month.toString(), stage: STAGE_MAP[time.Stage] ?? '0' };
            triggerObj.condition.push(`[*Custom.SpecificTime*]: ${toTimeText(time)}`);
          }
          // 條件為時間區間
          else {
            const minTime = triggerData._minTime;
            const maxTime = triggerData._maxTime;
            triggerObj.minTime = { year: minTime.Year.toString(), month: minTime.Month.toString(), stage: STAGE_MAP[minTime.Stage] ?? '0' };
            triggerObj.maxTime = { year: maxTime.Year.toString(), month: maxTime.Month.toString(), stage: STAGE_MAP[maxTime.Stage] ?? '0' };
            triggerObj.condition.push(`[*Custom.SpecificPeriod*]: ${toTimeText(minTime)}~${toTimeText(maxTime)}`);
          }
        }

        // 確認其他觸發條件
        for (const condition of triggerData._conditions) {
          const rules = [];
          for (const item of condition._items) {
            // 處理變數及判斷式
            const var1 = await getStatGroup(item._value1._name);
            const var2 = await getStatGroup(item._value2._name);
            const statment = handleStatement(var1, item._compareOp, var2, triggerObj.script);
            rules.push(statment.text);
            mergeRelation(triggerObj.rel.pre, statment.rel);

            // 有時間條件則更新最早最晚觸發時間
            if (!triggerData._dayCheck || triggerData._timeCheckType !== '特定') {
              const match = statment.text.match(regexTime);
              if (match && regexMinTime.test(match[1])) triggerObj.minTime = { year: match[2], month: match[3], stage: match[4] };
              if (match && regexMaxTime.test(match[1])) triggerObj.maxTime = { year: match[2], month: match[3], stage: match[4] };
            }
          }

          // 加入條件
          if (rules.length > 0) {
            if (condition._logicOp == 'OR') triggerObj.condition.push(rules.join('[*Custom.Or*]'));
            else triggerObj.condition.push(...rules);
          }
        }

        // 確認是否為地點觸發並判斷非地點觸發之優先權
        const position = triggerData._position;
        let priority = type == 'Main' ? 1 : triggerData._beforeMainMission ? 0 : 2;
        if (position != '無') {
          triggerObj.condition.push(`[*Custom.GoTo*][*Label.Place,${positionMap[position] ?? 'Unknown'}*]`);
          priority = 4;
        } else if (priority != 1) {
          triggerObj.condition.push(`※[*Custom.TriggerPriority,${priority ? 'LowerThan' : 'HigherThan'}*]`);
        }

        // 是否有設定接續觸發
        const nextState = triggerData._nextStateName;
        if (nextState) {
          let text;
          if (nextState == 'clear') text = `◎[*Custom.SetClear*]:[*Label.Mission,${missionId}*]`;
          else {
            text = `◎[*Label.Mission,${missionId}*][*Custom.SetTrigger*]:[*Label.Trigger,${nextState}*]`;
            mergeRelation(triggerObj.rel.to, { Trigger: [nextState] });
          }
          triggerObj.content.push({ form: 'effect', type: 'System', text });
        }

        // 設定排序值
        triggerObj.orderKey = triggerCustom?.[triggerId]?.orderKey ?? `${triggerObj.minTime.year}-${triggerObj.minTime.month.padStart(2, '0')}-${triggerObj.minTime.stage}-${priority}-${triggerId}`;

        // 回存結果
        trigger[triggerId] = triggerObj;
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 自由行動主流程
  const processFree = async (file) => {
    try {
      // 讀取任務資料
      const data = await getGameJson(file, 'FreePositionData');
      if (!isValidJson(data, file)) return;

      // 記錄資訊
      const name = removeUid(file).replace(regexPrefix, '');
      const id = positionMap[name] ?? name;
      mission['CM_Free'].trigger.push(id);
      const tmpSheet = nameDraft?.trigger?.[id]?.sheet ?? '';
      const triggerObj = {
        mission: 'CM_Free',
        active: true,
        script: data._defaultScript,
        content: [],
        remark: [],
        condition: [`[*Custom.GoTo*][*Label.Place,${id}*]`],
        rel: { pre: {}, post: {}, to: { Script: [data._defaultScript] }, from: { Mission: ['CM_Free'] } },
        type: 'SubFree',
        sheet: tmpSheet,
        minTime: { year: '1', month: '4', stage: '1' },
        maxTime: { year: '', month: '', stage: '' },
        orderKey: `1-04-1-3-${id}`,
        eventFlow: triggerCustom?.[id]?.eventFlow ?? undefined,
        stopFlow: triggerCustom?.[id]?.stopFlow ?? [],
        flowOrder: triggerCustom?.[id]?.flowOrder ?? undefined
      };
      updateNameDraftItem(nameDraft.trigger, id, name);
      nameDraft.trigger[id].sheet = tmpSheet;

      // 處理停用條件
      const disableKey = data?._disableCondition?._name;
      if (disableKey) {
        const disableData = await getGameJson(disableKey, 'ConditionResultData');
        if (isValidJson(disableData, disableKey)) {
          const disable = await getCondition(disableData, disableKey, true);
          triggerObj.condition.unshift(disable.name);
          mergeRelation(triggerObj.rel.pre, disable.rel);
        }
      }

      // 處理條件式
      for (const condition of data._conditionFlags ?? []) {
        // 初始化
        const branch = { form: 'branch', type: 'Switch', branches: [] };
        const rules = [];
        const trueSet = [];
        const falseSet = [];

        // 解析條件
        for (const item of condition._condition?._items ?? []) {
          const var1 = await getStatGroup(item._value1._name);
          const var2 = await getStatGroup(item._value2._name);
          const statment = handleStatement(var1, item._compareOp, var2);
          rules.push(statment.text);
          mergeRelation(triggerObj.rel.pre, statment.rel);
        }
        branch.text = `[*BranchType.Switch*]：${rules.join(convertLogic(condition._condition._logicOp))}`;

        // 解析影響旗標
        for (const item of condition._flagItem ?? []) {
          const flag = removeUid(item._flagData._name);
          const trueState = item._trueState;
          const falseState = item._falseState;
          mergeRelation(triggerObj.rel.post, { Flag: [flag] });
          if (trueState) trueSet.push({ form: 'effect', type: 'Flag', text: handleFlagStatement(flag, trueState, null, '=', true).text });
          if (falseState) falseSet.push({ form: 'effect', type: 'Flag', text: handleFlagStatement(flag, falseState, null, '=', true).text });
        }

        // 設定旗標內容
        if (trueSet.length > 0) branch.branches.push({ index: branch.branches.length + 1, text: '[*Custom.True*]', content: trueSet });
        if (falseSet.length > 0) branch.branches.push({ index: branch.branches.length + 1, text: '[*Custom.False*]', content: falseSet });

        triggerObj.content.push(branch);
      }

      // 回存結果
      trigger[id] = triggerObj;
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行處理主流程
  await Promise.all(freeFiles.map(processFree).concat(missionFiles.map(processMission)));
  mission['main'].trigger.unshift('CT_M0000');
  writeLog('log', '"Mission" parsed successfully!');

  // 並行輸出結果
  await Promise.all([exportJson(trigger, 'trigger'), exportJson(mission, 'mission'), exportJson(nameDraft, 'missionName')]);
  CACHE.TRIGGER = trigger;
  CACHE.MISSION = mission;
  CACHE_FULFILL.MISSION = true;
  CACHE_FULFILL.TRIGGER = true;
}

// 解析地點隨機事件資料
export async function parsePosition() {
  // 常用變數及常數
  const infoMap = {
    Back_02: { index: 110, period: '001', position: 'BackMountain', action: 'before-pickwood' },
    Back_03: { index: 111, period: '001', position: 'BackMountain', action: 'before-training' },
    Back_Work_001: { index: 112, period: '001', position: 'BackMountain', action: 'pickwood' },
    Back_Free_001: { index: 113, period: '001', position: 'BackMountain', action: 'training' },
    Mall_Work_001: { index: 121, period: '001', position: 'Mall', action: 'incense' },
    Mall_Free_001: { index: 122, period: '001', position: 'Mall', action: 'meditate' },
    Study_Work_001: { index: 131, period: '001', position: 'Study', action: 'book' },
    Alchemy_Work_001: { index: 141, period: '001', position: 'Alchemy', action: 'alchemy' },
    Forge_01: { index: 150, period: '001', position: 'Forge', action: 'before-forge' },
    Forge_Work_001: { index: 151, period: '001', position: 'Forge', action: 'forge' },
    Center_Work_001: { index: 161, period: '001', position: 'Center', action: 'sweep' },
    Center_Free_001: { index: 162, period: '001', position: 'Center', action: 'practice' },
    Kitchen_Work_001: { index: 171, period: '001', position: 'Kitchen', action: 'cook' },
    GirlRoom_Free_001: { index: 181, period: '001', position: 'Room2', action: 'origami' },
    GirlRoom_Work_001: { index: 182, period: '001', position: 'Room2', action: 'voyeur' },
    Room_Work_001: { index: 191, period: '001', position: 'Room1', action: 'sleep' },
    Door_02: { index: 210, period: '001', position: 'Door', action: 'door' },
    Door_Work_001: { index: 211, period: '001', position: 'Door', action: 'transaction' },
    Door_Free_001: { index: 221, period: '001', position: 'Downtown', action: 'walk' },
    Fortress_02: { index: 230, period: '001', position: 'Fortress', action: 'fortress' },
    Fortress_Work_001: { index: 231, period: '001', position: 'Fortress', action: 'housekeeper' },
    Teashop_Work_001: { index: 241, period: '001', position: 'Teashop', action: 'teashop' },
    Pharmacy_Work_001: { index: 251, period: '001', position: 'Pharmacy', action: 'doctor' },
    Farm_Work_001: { index: 261, period: '001', position: 'Farm', action: 'farm' },
    Spa_Free_001: { index: 271, period: '001', position: 'Spa', action: 'spa' },
    Fish_01: { index: 301, period: '901', position: '', action: 'fish' },
    Walk_01: { index: 302, period: '901', position: '', action: 'walk2' },
    Casino_01: { index: 303, period: '901', position: '', action: 'casino2' },
    Section_01_00: { index: 310, period: '006', position: '', action: 'sleep2' },
    Section_01_06_01: { index: 321, period: '006', position: 'Section_01_06', action: 'walk' },
    Section_01_06_02: { index: 322, period: '006', position: 'Section_01_06', action: 'casino' },
    Section_01_06_02_01: { index: 323, period: '006', position: 'Section_01_06', action: 'robbed' },
    Section_01_01: { index: 331, period: '006', position: 'Section_01_01', action: 'immortal' },
    Section_01_02_Start: { index: 340, period: '006', position: 'Section_01_02', action: 'before-training' },
    Section_01_02: { index: 341, period: '006', position: 'Section_01_02', action: 'training2' },
    Section_01_03: { index: 351, period: '006', position: 'Section_01_03', action: 'forge2' },
    Craft_Work_001: { index: 352, period: '006', position: 'Section_01_03', action: 'craft1' },
    Section_01_04: { index: 361, period: '006', position: 'Section_01_04', action: 'write' },
    Chess_01: { index: 371, period: '006', position: 'Section_01_05', action: 'chess' },
    Chess_02: { index: 372, period: '006', position: 'Section_01_05', action: 'chess' },
    Chess_03: { index: 373, period: '006', position: 'Section_01_05', action: 'chess' },
    Section_01_07: { index: 381, period: '006', position: 'Run', action: 'run' },
    Section_01_07_01: { index: 382, period: '006', position: 'Run', action: 'rival' },
    Section_01_08_06: { index: 391, period: '006', position: 'Section_01_08', action: 'firebird1' },
    S2800_02_Break_01: { index: 399, period: '006', position: 'S2800_02', action: 'jail' },
    Section_02_00: { index: 410, period: '003', position: '', action: 'sleep3' },
    Section_02_01_01: { index: 421, period: '003', position: 'Section_02_01', action: 'training3' },
    Section_02_01_02: { index: 422, period: '003', position: 'Section_02_01', action: 'walk3' },
    Section_02_02_01: { index: 431, period: '003', position: 'Section_02_02', action: 'cultivate' },
    Section_02_02_02: { index: 432, period: '003', position: 'Section_02_02', action: 'out1' },
    Section_02_03_01: { index: 441, period: '003', position: 'Section_02_03', action: 'walk' },
    Section_02_03_02: { index: 442, period: '003', position: 'Section_02_03', action: 'forge3' },
    Section_02_03_03: { index: 443, period: '003', position: 'Section_02_03', action: 'doctor2' },
    Travel_001: { index: 501, period: '902', position: 'Map', action: 'travel' },
    Travel_002: { index: 501, period: '903', position: 'Map', action: 'travel' },
    Travel_S2901_02: { index: 521, period: '913', position: 'Map', action: 'travel' },
    Travel_S2901_05: { index: 522, period: '914', position: 'Map', action: 'travel' },
    Travel_302: { index: 601, period: '904', position: 'Map', action: 'travel' },
    Ch_3_6_1_01: { index: 602, period: '905', position: '', action: 'walk4' },
    S2321_04_03_02: { index: 603, period: '915', position: '', action: 'walk4' },
    S2321_04_03_03: { index: 604, period: '915', position: '', action: 'sleep4' },
    Travel_310: { index: 605, period: '906', position: 'Map', action: 'travel' },
    Ch_3_1_7_2_01: { index: 611, period: '907', position: '', action: 'night' },
    Travel_401: { index: 701, period: '908', position: 'Map', action: 'travel' },
    Travel_501: { index: 721, period: '916', position: 'Map', action: 'travel' },
    Travel_S2501_01: { index: 801, period: '909', position: 'Map', action: 'travel' },
    Travel_S2503_01: { index: 802, period: '016', position: '', action: 'training4' },
    Travel_601_01: { index: 811, period: '911', position: 'Map', action: 'travel2' },
    Travel_601_02: { index: 812, period: '911', position: 'Map', action: 'travel3' },
    Ch_6_4_3_2_01: { index: 821, period: '912', position: '', action: 'music' }
  };
  const classMap = { 正常: 0, 失敗: 1, 大失敗: 2, 成功: 3, 大成功: 4, 特殊: 5, 其他: 9 };

  // 讀取檔案清單、前置Cache
  const [files, custom, nameDraft] = await Promise.all([getJsonList('PositionResultData'), getDataJson('positionCustom'), getDataJson('scriptName'), loadCache(['GROUP', 'FLAG'])]);

  // 初始化
  const result = {};

  // 檢查檔案數量
  if (files.length != Object.keys(infoMap).length) {
    writeLog('warn', '"PositionResultData" amount not matched.');
  }

  // 主流程
  const process = async (file) => {
    try {
      // 讀取資料
      const data = await getGameJson(file, 'PositionResultData');
      if (!isValidJson(data, file)) return;

      // 記錄資料
      const key = removeUid(file);
      const info = infoMap[key] ?? { index: 999, period: '', position: '', action: '' };
      const prefix = data._scriptPrefix;
      result[key] = {
        period: `[*MapPosition.Name.${info.period}*]`,
        position: info.position ? `[*Position.Name.${info.position}*]` : '',
        action: info.action ? `[*Position.title.${info.action}*]` : '',
        prefix: data._scriptPrefix,
        event: {},
        rel: { pre: {}, to: {} },
        orderKey: info.index
      };

      for (const item of data._list ?? []) {
        // 讀取對應劇本資料
        const eventData = await getGameJson(item._name, 'PositionEventData');
        if (!isValidJson(eventData, file)) continue;
        const mapData = await getGameJson(eventData._config._name, 'StoryMappingItem');
        if (!isValidJson(mapData, file)) continue;

        // 記錄對應劇本資訊
        const id = mapData.Value;
        const script = `${prefix}_${id}`;
        const keys = mapData.Key.split('_');
        const event = {
          name: mapData.Key,
          class: classMap[keys[0]] ?? 0,
          seq: keys[1] ?? '000',
          condition: [],
          rate: [`[#${eventData._defaultRate}#]`],
          script,
          remark: [],
          eventFlow: custom?.[key]?.event?.[id]?.eventFlow ?? undefined,
          stopFlow: custom?.[key]?.event?.[id]?.stopFlow ?? [],
          flowOrder: custom?.[key]?.event?.[id]?.flowOrder ?? undefined
        };
        mergeRelation(result[key].rel.to, { Script: [script] });
        updateNameDraftItem(nameDraft, script, (eventData._devNote ?? '').trim());

        // 記錄觸發條件
        if (eventData._toggleCondition) {
          for (const subItem of eventData._activeCondition?._items ?? []) {
            const var1 = await getStatGroup(subItem._value1._name);
            const var2 = await getStatGroup(subItem._value2._name);
            const statment = handleStatement(var1, subItem._compareOp, var2, script);
            event.condition.push(statment.text);
            mergeRelation(result[key].rel.pre, statment.rel);
          }
        }

        // 記錄權重
        for (const subItem of eventData._eventRateItem ?? []) {
          const rules = [];
          for (const infraItem of subItem._condition?._items ?? []) {
            const var1 = await getStatGroup(infraItem._value1._name);
            const var2 = await getStatGroup(infraItem._value2._name);
            const statment = handleStatement(var1, infraItem._compareOp, var2, script);
            rules.push(statment.text);
            mergeRelation(result[key].rel.pre, statment.rel);
          }
          event.rate.push(`${rules.join('[*Custom.And*]')}[#${subItem._rate >= 0 ? '+' : ''}${subItem._rate ?? '?'}#]`);
        }

        // 清單重複處理
        if (result[key].event[id]) {
          writeLog('warn', `"${key}"-"${id}" duplicated.`);
          event.remark.push('※[*Position.Remark.Common.0*]');
        }

        // 回存結果
        result[key].event[id] = event;
      }
    } catch (err) {
      writeLog('error', `Processing file "${file}" failed.`, err.stack);
    }
  };

  // 並行處理主流程
  await Promise.all(files.map(process));
  writeLog('log', '"Position" parsed successfully!');

  // 並行輸出結果
  await Promise.all([exportJson(result, 'position'), exportJson(nameDraft, 'scriptName')]);
  CACHE.POSITION = result;
  CACHE_FULFILL.POSITION = true;
}

// Helper: 產生純邏輯內容
function buildLogicView(content) {
  // 空白分歧
  if (!content || content.length === 0) {
    return { content: [{ form: 'effect', type: 'Info', text: '※[*System.NA*]' }], effects: ['Info'] };
  }

  // 初始化
  const result = [];
  const currentEffects = new Set();
  let effectBuffer = [];

  // Helper: 將當前收集到的 effect 合併推入 result
  const flushEffects = () => {
    if (effectBuffer.length > 0) {
      result.push({ form: 'effect', text: effectBuffer.join(' / ') });
      effectBuffer = [];
    }
  };

  for (const node of content) {
    if (node.form === 'effect') {
      effectBuffer.push(node.text);
      currentEffects.add(node.type);
    } else if (node.form === 'perform') {
      if (node.type === 'Say') flushEffects();
    } else if (node.form === 'branch') {
      flushEffects();

      // 遞迴處理子分支
      const newBranch = { ...node, branches: [], effects: [] };
      const branchEffects = new Set();

      for (const b of node.branches) {
        const sub = buildLogicView(b.content);

        newBranch.branches.push({ ...b, content: sub.content, effects: sub.effects });

        sub.effects.forEach((t) => {
          branchEffects.add(t);
          currentEffects.add(t);
        });
      }

      newBranch.effects = Array.from(branchEffects);
      result.push(newBranch);
    } else {
      // 其他未知類型
      flushEffects();
      result.push(node);
    }
  }

  // 處理剩餘effect
  flushEffects();

  // 處理僅演出變化分岐
  if (result.length === 0) {
    return { content: [{ form: 'effect', type: 'Info', text: '※[*Custom.OnlyPerform*]' }], effects: ['Info'] };
  }

  return { content: result, effects: Array.from(currentEffects) };
}

// 解析戰鬥事件
export async function parseCombat() {
  // 讀取檔案清單、前置Cache
  const [files, custom, supportCustom, nameDraft] = await Promise.all([
    getJsonList('CombatLevel'),
    getDataJson('combatCustom'),
    getDataJson('supportCustom'),
    getDataJson('combatName'),
    loadCache(['GROUP', 'FLAG', 'TERM'])
  ]);

  // 初始化
  const regexPct = /^(.+?)(百分比)?$/;
  const result = {};
  const logicResult = {};
  const termMap = {
    char: { 敵方: 'Enemy', 我方: 'Player' },
    stat: { 血量: 'hp', 氣力: 'sp', 血量值: 'hp', 氣力值: 'sp', 毒藥: 'poison-value', 麻痺: 'paralysis-value' },
    type: { 新增: 'Add', 移除: 'Remove', 無法動作: 'BanAction' },
    action: { 無動作: 'idle', 絕招: 'ultimate', 絕招1: 'ultimate', 絕招2: 'ultimate', 絕招3: 'ultimate', 備揍: 'block', 暗器: 'weapon', 捅人: 'attack', 嘴砲: 'curse', 指令: 'action' }
  };
  const cache = { action: {}, condition: {}, character: {}, effect: {} };

  // Helper: 轉換詞語
  const getTerm = (type, term, parent = 'Custom') => `[*${parent}.${termMap?.[type]?.[term] ?? 'Unknown'}*]`;

  // Helper: 輔助技能轉換角色
  const queryCharacterIds = (supportId) => {
    const supportName = CACHE.TERM.COMBAT_SKILL?.[supportId];
    const customIds = supportCustom?.[supportId]?.name ?? [];
    const charIds = customIds.length ? customIds : [REF_MAP.CHARACTER?.[supportName]];
    const result = [];
    for (const charId of charIds) {
      if (charId) result.push(charId);
      // 記錄給草稿用
      else supportCustom[supportId] = { name: [], support: supportName ?? '' };
    }
    return result;
  };

  // Helper: 取得決鬥效果
  const getCombatEffect = async (name) => {
    // 檢查Cache
    let effect = cache.effect?.[name];
    if (effect) return effect;

    // 讀取資料
    const data = await getGameJson(name, 'CombatStateEffectScriptable');
    if (!isValidJson(data, name)) effect = { key: '[*CombatSkill.Name.Unknown*]', type: '[*Custom.Unknown*]', show: false };
    else {
      const id = data._key;
      const type = data._stateType;
      effect = { key: `[*Label.${type},${id}*]`, type: `[*Custom.${type}*]`, show: data._show ? '' : '*', rel: { Effect: [id] } };
      if (type === 'Support') {
        const charIds = queryCharacterIds(id);
        if (charIds) effect.rel.Character = charIds;
      }
    }

    // 寫入Cache並回傳
    return (cache.effect[name] = effect);
  };

  // 勝敗旗標處理流程
  const processResult = (results, rel, combatId) => {
    const content = [];
    for (const item of results ?? []) {
      const flagId = removeUid(item._flag._name);
      const state = item._state || 0;
      const stat = handleFlagStatement(flagId, state, combatId, undefined, true);
      mergeRelation(rel.post, { Flag: [flagId] });
      content.push({ form: 'effect', type: 'Flag', text: stat.text });
    }
    return content.length > 0 ? content : [{ form: 'effect', type: 'Remark', text: '※[*System.NA*]' }];
  };

  // 行動處理流程
  const processAction = async (action, enemyName, rel, combatId) => {
    // 取得鍵值
    const type = action._type;
    const key = action._name;
    const cacheId = `${combatId}:${type}:${key}`;

    // 取得Cache或解析內容
    const subResult =
      cache.action?.[cacheId] ??
      (await (async () => {
        try {
          // 載入行動
          const data = await getGameJson(key, type);
          if (!isValidJson(data, key)) {
            return { content: [{ form: 'effect', type: 'System', text: '※[*Custom.Unknown*]' }] };
          }

          // 解析行動
          switch (type) {
            // 強制指令
            case 'CombatEventActionCrazyMode': {
              const text = `${getTerm('char', data._character)}[*Custom.ForceAction*]:[*CombatAction.${data._mode.toLowerCase()}*]`;
              return { content: [{ form: 'effect', type: 'Action', text }] };
            }
            // 事件對話
            case 'CombatEventActionDialog': {
              const content = [{ form: 'effect', type: 'Dialog', text: '◇[*Custom.EventDialog*]' }];
              for (const dialogItem of data._dialogs) {
                // 記錄資料
                const dialogChar = dialogItem._character;
                const dialog = { char: '', type: 'character', lines: `[*CombatTalking.${dialogItem._key}*]` };

                // 記錄說話角色
                if (dialogChar.startsWith('第三者', 2)) {
                  const charId = await queryItemId(dialogItem._characterKey._name, cache.character, 'StoryMappingItem');
                  dialog.char = `[*CombatCharacter.Name.${charId}*]`;
                } else if (dialogChar.startsWith('我方')) dialog.char = '[*CombatCharacter.Name.player*]';
                else if (dialogChar.startsWith('敵方')) dialog.char = enemyName;

                // 記錄說話類別
                if (dialogChar.endsWith('心想')) dialog.type = 'think';
                else if (dialogChar.endsWith('旁白')) dialog.type = 'narration';

                const text = `${dialog.char}[*DialogType.${dialog.type}*]「${dialog.lines}」`;
                content.push({ form: 'perform', type: 'Dialog', text });
              }
              return { content };
            }
            // 記錄回合數
            case 'CombatEventActionFlagRound': {
              const flagId = removeUid(data._flag._name);
              const text = `[*Label.Flag,${flagId}.0*]=[*Custom.Round*]+${data._add}`;
              return { content: [{ form: 'effect', type: 'Flag', text }], rel: { Flag: [flagId] } };
            }
            // 結束戰鬥
            case 'CombatEventActionLoadScene': {
              return { content: [{ form: 'effect', type: 'System', text: '◎[*Custom.EndCombat*]' }] };
            }
            // 設定旗標
            case 'CombatEventActionModifyFlag': {
              const flagId = removeUid(data._flag._name);
              const stat = handleFlagStatement(flagId, data._state, combatId, undefined, true);
              return { content: [{ form: 'effect', type: 'Flag', text: stat.text }], rel: { post: { Flag: [flagId] } } };
            }
            // 異動角色數值
            case 'CombatEventActionModifyStat':
            case 'CombatEventActionModifyWeaponValue': {
              const unit = data._valueType == '百分比' ? '%' : '';
              const vfx = data._useVFX ? '([*Custom.VFX*])' : '';
              const sign = data._value >= 0 ? '+' : '';
              const text = `${getTerm('char', data._character)}${getTerm('stat', data._type, 'PlayerStat')}${sign}${data._value}${unit}${vfx}`;
              return { content: [{ form: 'effect', type: 'Stat', text }] };
            }
            // 輔助角色被攻擊
            case 'CombatEventActionPunchSupport': {
              const effect = await getCombatEffect(data._support._name);
              const text = `${effect.key}[*Custom.Attacked*]`;
              return { content: [{ form: 'effect', type: 'Action', text }] };
            }
            // 依好感度攻擊
            case 'CombatEventActionRelationshipAttack': {
              const charId = data._relationshipData._name.toLowerCase().replace(REGEX_RELATIONSHIP, '$1');
              const vfx = data._useVFX ? '([*Custom.VFX*])' : '';
              const text = `[*Label.Character,${charId}*][*Custom.RelationshipAttack*]${vfx}`;
              return { content: [{ form: 'effect', type: 'Action', text }], rel: { intra: { Character: [charId] } } };
            }
            // 移除所有狀態
            case 'CombatEventActionRemoveAllStateEffect': {
              const text = `${getTerm('char', data._character)}[*Custom.RemoveAllState*]`;
              return { content: [{ form: 'effect', type: 'State', text }] };
            }
            // 移除所有輔助
            case 'CombatEventActionRemoveAllSupport': {
              const text = `${getTerm('char', data._character)}[*Custom.RemoveAllSupport*]`;
              return { content: [{ form: 'effect', type: 'State', text }] };
            }
            // 設定戰鬥後接續劇本
            case 'CombatEventActionSetStoryScript': {
              return { content: [{ form: 'effect', type: 'System', text: `◎[*Custom.CombatNextScript*][*Label.Script,${data._name}*]` }], rel: { to: { Script: [data._name] } } };
            }
            // 異動角色狀態
            case 'CombatEventActionStateEffect': {
              const effect = await getCombatEffect(data._effect._name);
              const text = `${effect.show}${getTerm('char', data._character)}${getTerm('type', data._type)}${effect.key}`;
              return { content: [{ form: 'effect', type: 'State', text }], rel: data._type === '新增' ? { intra: effect.rel } : null };
            }
            case 'CombatEventActionReduceEffectCount': {
              const effect = await getCombatEffect(data._effect._name);
              const text = `${effect.show}${getTerm('char', data._character)}${effect.key}[*Custom.Reduce,${data._amount}*]`;
              return { content: [{ form: 'effect', type: 'State', text }] };
            }
            // 顯示特效
            case 'CombatEventActionShowImage': {
              return { content: [{ form: 'effect', type: 'Perform', text: '◇[*Custom.ShowImage*]' }] };
            }
            // 顯示特效
            case 'CombatEventActionVFX': {
              return { content: [{ form: 'effect', type: 'Perform', text: '◇[*Custom.VFX*]' }] };
            }
            // 計數事件
            case 'CombatEventActionCount': {
              const branches = [];
              for (const item of data._items ?? []) {
                const actions = [];
                for (const action of item.Actions ?? []) {
                  actions.push(await processAction(action, enemyName, rel, combatId));
                }
                branches.push({ index: 0, text: `[*Custom.Count*]=${item.Count}`, content: actions.flat() });
              }
              return { content: [{ form: 'branch', type: 'Count', text: '', branches }] };
            }
            // 無對應
            default:
              writeLog('error', `Parsing combat action "${cacheId}" failed.`);
              return { content: [] };
          }
        } catch (err) {
          writeLog('error', `Parsing combat action "${cacheId}" failed.`, err);
          return { content: [] };
        }
      })());

    // 寫入Cache並回傳
    cache.action[cacheId] ??= subResult;
    if (subResult?.rel?.intra) mergeRelation(rel.intra, subResult.rel.intra);
    if (subResult?.rel?.post) mergeRelation(rel.post, subResult.rel.post);
    if (subResult?.rel?.to) mergeRelation(rel.to, subResult.rel.to);
    return subResult.content;
  };

  // 條件式處理
  const processCondition = async (condition, rel, combatId) => {
    // 取得鍵值
    const type = condition._type;
    const key = condition._name;
    const cacheId = `${combatId}:${type}:${key}`;

    // 取得Cache或解析內容
    const subResult =
      cache.condition?.[cacheId] ??
      (await (async () => {
        try {
          // 讀取檔案
          const data = await getGameJson(key, type);
          if (!isValidJson(data, key)) return `[*Custom.InvalidCondition,${key}*]`;

          switch (type) {
            // 檢定行動結果
            case 'CombatEventConditionActionResult': {
              const text = `[%${getTerm('char', data._character)}${getTerm('type', data._type)}%]`;
              return { text };
            }
            // 檢定行動種類
            case 'CombatEventConditionActionType': {
              const typesText = [...new Set(data._typeList.map((a) => getTerm('action', a, 'CombatAction')))].join('[*Custom.Or*]');
              const actionResult = data._checkHit ? (data._hit ? '[*Custom.Hit*]' : '[*Custom.NotHit*]') : data._checkSuccess ? (data._success ? '[*Custom.Success*]' : '[*Custom.Failed*]') : '';
              const text = `[%${getTerm('char', data._character)}[*Custom.Use*]${typesText}${actionResult}%]`;
              return { text };
            }
            // 檢定狀態
            case 'CombatEventConditionEffectState': {
              const effect = await getCombatEffect(data._effectState._name);
              const text = `[%${getTerm('char', data._character)}[*Custom.Have*]${effect.key}%]`;
              return { text };
            }
            // 檢定數值
            case 'CombatEventConditionPlayerStat': {
              const var1 = await getStat(data._stat);
              const statment = handleStatement(var1, data._op, data._value, combatId);
              return { text: statment.text, rel: statment.rel };
            }
            // 檢定回合
            case 'CombatEventConditionRound': {
              const text = `[%[*Custom.Round*]${convertComparison(data._op)}${data._round}%]`;
              return { text };
            }
            // 檢定回合旗標
            case 'CombatEventConditionRoundFlag': {
              const flagId = removeUid(data._flagData._name);
              const text = `[%[*Custom.Round*]${convertComparison(data._op)}[*Label.Flag,${flagId}*]%]`;
              return { text, rel: { Flag: [flagId] } };
            }
            // 檢定戰鬥數值
            case 'CombatEventConditionStat': {
              const match = data._type.match(regexPct);
              const stat = getTerm('stat', match[1], 'PlayerStat');
              const unit = match[2] ? '%' : '';
              const text = `[%${getTerm('char', data._character)}${stat}${convertComparison(data._op)}${data._value}${unit}%]`;
              return { text };
            }
            // 檢定防禦攻擊
            case 'CombatEventConditionBlockCounterAttack': {
              const typesText = [...new Set(data._attackActionType.map((a) => getTerm('action', a, 'CombatAction')))].join('[*Custom.Or*]');
              const actionResult = data._blockResult == '招架成功' ? '[*CombatInfo.parrySuccess*]' : '';
              const text = `[%${getTerm('char', data._character)}[*CombatAction.block*][*Custom.Counter*]${typesText}${actionResult}%]`;
              return { text };
            }
            // 無對應
            default:
              writeLog('error', `Parsing combat condition "${cacheId}" failed.`);
              return { text: 'Error' };
          }
        } catch (err) {
          writeLog('error', `Parsing combat condition "${cacheId}" failed.`, err);
          return { text: 'Error' };
        }
      })());

    // 寫入Cache並回傳
    cache.condition[cacheId] ??= subResult;
    if (subResult?.rel) mergeRelation(rel.pre, subResult.rel);
    return subResult.text;
  };

  // 主流程
  const process = async (file) => {
    try {
      // 讀取戰鬥資料
      const data = await getGameJson(file, 'CombatLevel');
      if (!isValidJson(data, file)) return;

      // 讀取敵人資料
      const enemyData = await getGameJson(data._enemyStat._name, 'CombatStat');
      if (!isValidJson(enemyData, `${file}:${data._enemyStat._name}`)) return;

      // 記錄資訊
      const id = removeUid(file);
      const enemyName = `[*CombatCharacter.Name.${enemyData.Name}*]`;
      const branch = { form: 'branch', type: 'Combat', text: '', branches: [] };
      const combat = { enemy: enemyName, content: [branch], rel: { pre: {}, post: {}, intra: {}, to: {} }, remark: Array.from(custom?.[id]?.remark ?? [], (_, i) => `[*Combat.Remark.${id}.${i}*]`) };
      mergeCharacterRelation(combat.rel.intra, enemyData.Name);
      updateNameDraftItem(nameDraft, id, `${data._desc} 戰${CACHE.TERM.CHARACTER?.[enemyData.Name]}`, `[*System.Combat*]-${enemyName}`);

      // 解析戰鬥中事件
      for (const item of data.Events ?? []) {
        // 讀取事件資料
        const eventData = await getGameJson(item._name, 'CombatEventData');
        if (!isValidJson(eventData, item._name)) continue;

        // 解析初始事件
        const initActions = [];
        for (const subItem of eventData._initAction ?? []) {
          initActions.push(...(await processAction(subItem, enemyName, combat.rel, id)));
        }
        if (initActions.length > 0) branch.branches.push({ index: 0, text: '[*Custom.Init*]', content: initActions });

        // 解析條件觸發事件
        for (const subItem of eventData._conditionAction ?? []) {
          const subData = await getGameJson(subItem._name, 'CombatEventConditionAction');
          if (!isValidJson(subData, item._name)) continue;

          // 初始化變數
          const conditionPromises = (subData._conditions ?? []).map((c) => processCondition(c, combat.rel, id));
          const actionItems = [...(subData._actions ?? []), ...(subData._afterActions ?? []), ...(subData._afterResult ?? [])].filter((item) => item != null);
          const actionPromises = actionItems.map((a) => processAction(a, enemyName, combat.rel, id));

          // 並行等待結果
          const [conditions, actions] = await Promise.all([Promise.all(conditionPromises), Promise.all(actionPromises)]);

          // 記錄結果
          if (conditions.length > 0) {
            const text = conditions.join(convertLogic(subData._logic));
            branch.branches.push({ index: 0, text, content: actions.flat() });
          }
        }
      }

      // 解析勝利影響
      const winResults = processResult(data._winResult, combat.rel, id);
      branch.branches.push({ index: 0, text: '[*Custom.Win*]', content: winResults });

      // 解析戰敗影響
      const loseResults = processResult(data._loseResult, combat.rel, id);
      if (data._deadEnd && data._deadLibrary) {
        const libraryId = removeUid(data._deadLibrary._name);
        const deadEndName = `[*Label.Dead,${libraryId}*]`;
        loseResults.push({ form: 'effect', type: 'Dead', text: deadEndName });
        mergeRelation(combat.rel.post, { Dead: [libraryId] });
      }
      branch.branches.push({ index: 0, text: '[*Custom.Lost*]', content: loseResults });

      const logic = buildLogicView(combat.content);
      result[id] = combat;
      logicResult[id] = { ...combat, content: logic.content, effects: logic.effects };
    } catch (err) {
      writeLog('error', `Parsing combat "${file}" failed.`, err.stack);
    }
  };

  // 並行處理主流程
  await Promise.all(files.map(process));
  writeLog('log', '"Combat" parsed successfully!');

  // 並行輸出結果
  await Promise.all([exportJson(logicResult, 'combat'), exportJson(result, 'combatFull'), exportJson(nameDraft, 'combatName'), exportJson(supportCustom, 'supportCustom')]);
  CACHE.COMBAT = logicResult;
  CACHE.COMBAT_FULL = result;
  CACHE_FULFILL.COMBAT = true;
}

// 解析戰役事件
export async function parseBattle() {
  // 讀取檔案清單、前置Cache
  const [files, nameDraft] = await Promise.all([getJsonList('BattleLevel'), getDataJson('battleName'), loadCache(['GROUP', 'FLAG', 'TERM'])]);

  // 初始化
  const result = {};
  const cache = { npc: {} };

  // Helper: 取得NPC資訊
  const getNpcStat = async (name) => {
    // 檢查Cache
    let npc = cache.npc?.[name];
    if (npc) return npc;

    // 取得NPC設定
    const configData = await getGameJson(name, 'BattleNpcConfigData');
    if (!isValidJson(configData, name)) return { id: '', name: '[*Label.Enemy,Unknown*]', people: '0×0%' };

    // 取得NPC勢力別
    const statData = await getGameJson(configData._teamStat._name, 'BattleTeamStat');
    if (!isValidJson(statData, configData._teamStat._name)) return { id: '', name: '[*Label.Enemy,Unknown*]', people: '0×0%' };

    // 取得NPC門人數及向心值
    const [peopleData, teamData] = await Promise.all([getGameJson(statData._people?._name ?? '', 'GameStat'), getGameJson(statData._team?._name ?? '', 'GameStat')]);
    const people = isValidJson(peopleData, statData._people._name) ? peopleData._default : 0;
    const team = isValidJson(teamData, statData._team._name) ? teamData._default : 0;

    // 紀錄資訊
    const id = statData._id == '000' ? '500' : statData._id;
    npc = { id, name: `[*Label.Enemy,${id}*]`, people: `${people}×${team}%` };

    // 寫入Cache並回傳
    return (cache.npc[name] = npc);
  };

  // 主流程
  const process = async (file) => {
    try {
      // 讀取戰鬥資料
      const data = await getGameJson(file, 'BattleLevel');
      if (!isValidJson(data, file)) return;

      // 記錄資訊
      const id = removeUid(file);
      const type = data._nameKey;
      result[id] = {
        type,
        friend: {},
        enemy: {},
        neutral: {},
        end: [
          { condition: '[%[*Custom.GiveUp*]%]', result: '[*Label.Flag,BattleResult_001.0*]=[*Flag.BattleResult_001.0.0*]' },
          { condition: '[%[*Custom.PlayerDie*]%]', result: '[*Custom.BattleDie*]' }
        ],
        rel: { pre: {}, to: {} }
      };

      // 取得敵我中立方陣容資料
      const [friends, enemies, neutrals] = await Promise.all([
        Promise.all(data._friendConfig.map((c) => getNpcStat(c._name))),
        Promise.all(data._enemyConfig.map((c) => getNpcStat(c._name))),
        Promise.all(data._neutralConfig.map((c) => getNpcStat(c._name)))
      ]);

      // 記錄我方陣容及人數
      result[id].friend.name = friends.map((c) => c.name);
      if (data._friendUsePeople) {
        if (data._friendPeopleFlag) {
          const flag = removeUid(data._friendPeopleFlag._name);
          const statment = handleFlagStatement(flag, undefined, id);
          result[id].friend.people = statment.left;
          mergeRelation(result[id].rel.pre, { Flag: [flag] });
        } else result[id].friend.people = data._friendPeople;
      } else {
        result[id].friend.people = '[*Label.Stat,people*]×[*Label.Stat,team*]%';

        // 非單獨唐門提供初始值
        if (friends.length > 1 || friends[0]?.name != '[*Label.Enemy,500*]') {
          result[id].friend.people += ` ([*Custom.Init*]:${friends.map((f) => f.people).join('+')})`;
        }
      }

      // 記錄敵方陣容及人數
      result[id].enemy.name = enemies.map((c) => c.name);
      if (data._enemyUsePeople) {
        if (data._enemyPeopleFlag) {
          const flag = removeUid(data._enemyPeopleFlag._name);
          const statment = handleFlagStatement(flag, undefined, id);
          result[id].enemy.people = statment.left;
          mergeRelation(result[id].rel.pre, { Flag: [flag] });
        } else result[id].enemy.people = data._enemyPeople;
      } else result[id].enemy.people = `[*Label.Stat,people*]×[*Label.Stat,team*]% ([*Custom.Init*]:${enemies.map((f) => f.people).join('+')})`;

      // 記錄中立方陣容及人數
      result[id].neutral.name = neutrals.map((c) => c.name);
      if (neutrals.length > 0) {
        if (data._neutralUsePeople) {
          if (data._neutralPeopleFlag) {
            const flag = removeUid(data._neutralPeopleFlag._name);
            const statment = handleFlagStatement(flag, undefined, id);
            result[id].neutral.people = statment.left;
            mergeRelation(result[id].rel.pre, { Flag: [flag] });
          } else result[id].neutral.people = data._neutralPeople;
        } else result[id].neutral.people = `[*Label.Stat,people*]×[*Label.Stat,team*]% ([*Custom.Init*]:${neutrals.map((f) => f.people).join('+')})`;
      } else result[id].neutral.people = '';

      // 結束條件
      if (data._victoryDefeat) {
        result[id].end.unshift({ condition: '[%[*Custom.FriendDefeat*]%]', result: '[*Label.Flag,BattleResult_001.0*]=[*Flag.BattleResult_001.0.0*]' });
        result[id].end.unshift({ condition: '[%[*Custom.EnemyDefeat*]%]', result: '[*Label.Flag,BattleResult_001.0*]=[*Flag.BattleResult_001.0.1*]' });
      }
      if (data._victoryTimeout) {
        result[id].end.unshift({
          condition: `[%[*Custom.Timeout,${data._time}*]%][*Custom.And*][%[*Custom.Player*][*PlayerStat.npcs*]<[*Custom.Enemy*][*PlayerStat.npcs*]%]`,
          result: '[*Label.Flag,BattleResult_001.0*]=[*Flag.BattleResult_001.0.0*]'
        });
        result[id].end.unshift({
          condition: `[%[*Custom.Timeout,${data._time}*]%][*Custom.And*][%[*Custom.Player*][*PlayerStat.npcs*]≥[*Custom.Enemy*][*PlayerStat.npcs*]%]`,
          result: '[*Label.Flag,BattleResult_001.0*]=[*Flag.BattleResult_001.0.1*]'
        });
      }

      // 處理命名草稿
      const friendsName = friends.map((f) => CACHE.TERM.TEAM?.[f.id]).join('+');
      const enemiesName = enemies.map((f) => CACHE.TERM.TEAM?.[f.id]).join('+');
      updateNameDraftItem(nameDraft, id, `${friendsName} vs ${enemiesName}`, `[*System.Battle*]-[*EnemyTeam.${type}*]`);
    } catch (err) {
      writeLog('error', `Parsing battle "${file}" failed.`, err.stack);
    }
  };

  // 並行處理主流程
  await Promise.all(files.map(process));
  writeLog('log', '"Battle" parsed successfully!');

  // 並行輸出結果
  await Promise.all([exportJson(result, 'battle'), exportJson(nameDraft, 'battleName')]);
  CACHE.BATTLE = result;
  CACHE_FULFILL.BATTLE = true;
}

// 解析劇本資料 (Lua)
export async function parseScript() {
  // Helper: 讀取Lua清單
  async function getLuaList(dir) {
    try {
      // 遊戲lua檔案無附檔名，不做filter
      const luas = await readdir(dir);

      if (luas.length === 0) {
        writeLog('warn', `No lua files found with the lua script folder.`);
        return [];
      }
      return luas;
    } catch (err) {
      writeLog('error', `Reading files from lua script folder failed.`, err.message);
      return [];
    }
  }

  // 讀取檔案清單、前置Cache
  const folder = path.join(GAME_PATH, 'TextAsset', 'story', 'chinesetraditional');
  const [files, custom, free, nameDraft, fullCustom] = await Promise.all([
    getLuaList(folder),
    getDataJson('scriptCustom'),
    getDataJson('scriptFree'),
    getDataJson('scriptName'),
    getDataJson('scriptFullCustom'),
    loadCache(['GROUP', 'SKILL', 'FLAG', 'TERM', 'SWITCH', 'CONDITION', 'DICE', 'COMBAT', 'BATTLE'])
  ]);

  // 常數
  const regexScriptLabel = /^\[\*Label\.Script,(.*?)\*\]$/;
  const regexQuote = /^"(.+)"$/;
  const regexDice = /^"(\w+)\|([=><]+)(\d+)"$/;
  const regexGE = /^>=$/;
  const regexLE = /^<=$/;
  const regexFlagCheck = /^\[%\[\*Label\.Flag,(\w+)\.(\d+)\*\]%\]$/;
  const regexFlagValue = /^\[\*Flag\.(\w+)\.(\d+)\.(-?\d+)\*\]$/;
  const regexXFull = /\[%\[\*Flag\.(\w+)\.X\*\]([<>=≤≥≠])\[\*Flag\.\w+\.X\.(-?\d+)\*\]%\]/g;
  const regexXName = /\[\*Flag\.(\w+)\.X\*\]/g;
  const regexXValue = /\[\*Flag\.(\w+)\.X\.(-?\d+)\*\]/g;
  const positionList = ['Alchemy', 'Center', 'Back', 'Mall', 'Study', 'Forge', 'Kitchen', 'GirlRoom', 'Room', 'Door', 'Downtown', 'Fortress', 'Teashop', 'Pharmacy', 'Farm', 'Spa'];

  // 初始化
  const result = {};
  const logicResult = {};

  // 加入額外自訂
  for (const [id, item] of Object.entries(custom) ?? []) {
    if (id.startsWith('CS_')) {
      result[id] = { ...item, remark: Array.from(item?.remark ?? [], (_, i) => `[*Script.Remark.${id}.${i}*]`) };
      const tmpLogic = buildLogicView(result[id].content);
      logicResult[id] = { ...result[id], content: tmpLogic.content, effects: tmpLogic.effects };
      updateNameDraftItem(nameDraft, id);
    }
  }

  // Helper: 去除雙引號
  const removeQuote = (raw) => raw.replace(regexQuote, '$1');

  // Helper: 加入標籤
  const addLabel = (text) => (text ? `[*Label.Script,${text}*]` : null);

  // Helper: 檢查標籤
  const checkLabel = (text) => {
    const match = text.match(regexScriptLabel);

    if (match) return match[1];
    return null;
  };

  // Helper: 取得參數值
  const getArgumentValue = (argument, cache) => {
    if (!argument) return undefined;
    if (argument.type === 'Identifier') return cache?.var?.[argument.name] ?? argument.name;
    return argument.value ?? argument.argument.value * -1;
  };

  // Helper: 轉換未確認X旗標
  const convertXFlag = (ori, script, type) => {
    // 檢查特殊情況
    const checkFlag = (flagData, index, id, val, symbol) => {
      // 處理資料
      const name = `[*Label.Flag,${id}.${index}*]`;
      const value = val && flagData?.value?.[val] ? `[*Flag.${id}.${index}.${val}*]` : val;

      // 僅旗標名稱
      if (!val) return name;

      // 僅旗標值
      if (!symbol) return value;

      // 完整式子
      return `[%${name}${symbol}${value}%]`;
    };

    // 取代X旗標值(完整式子)
    const replaceFull = (text) => {
      return text.replace(regexXFull, (match, id, symbol, val) => {
        const flagItems = CACHE.FLAG?.[id].data;
        if (flagItems && flagItems.length > 0) {
          for (let i = 0; i < flagItems.length; i++) {
            if (flagItems[i].script.includes(script)) {
              return checkFlag(flagItems[i], i, id, val, symbol);
            }
          }
          return checkFlag(flagItems[0], 0, id, val, symbol);
        }
        return match;
      });
    };

    // 取代X旗標值(旗標名稱)
    const replaceName = (text) => {
      return text.replace(regexXName, (match, id) => {
        const flagItems = CACHE.FLAG?.[id].data;
        if (flagItems && flagItems.length > 0) {
          for (let i = 0; i < flagItems.length; i++) {
            if (flagItems[i].script.includes(script)) {
              return checkFlag(flagItems[i], i, id);
            }
          }
          return checkFlag(flagItems[0], 0, id);
        }
        return match;
      });
    };

    // 取代X旗標值(旗標值)
    const replaceValue = (text) => {
      return text.replace(regexXValue, (match, id, val) => {
        const flagItems = CACHE.FLAG?.[id].data;
        if (flagItems && flagItems.length > 0) {
          for (let i = 0; i < flagItems.length; i++) {
            if (flagItems[i].script.includes(script)) {
              return checkFlag(flagItems[i], i, id, val);
            }
          }
          return checkFlag(flagItems[0], 0, id, val);
        }
        return match;
      });
    };

    // 依類別處理
    switch (type) {
      case 'check':
        return replaceName(replaceFull(ori));
      case 'switch':
        return replaceValue(replaceFull(ori));
      default:
        return replaceFull(ori);
    }
  };

  // Helper: 檢查是否有Switch潛在旗標名稱
  const getPotentialBranchLabel = (check, labels, index) => {
    const cleanLabels = labels.filter(Boolean);

    // 檢查是否為旗標
    const match = check.match(regexFlagCheck);
    if (match) {
      const flagId = match[1];
      const flagIndex = match[2];
      const flagKeys = Object.keys(CACHE.FLAG[flagId].data[flagIndex].value);

      // 至少設定2個值才繼續
      if (flagKeys.length < 2) return null;

      // 標籤轉成旗標值索引
      const labelIndex = cleanLabels.map((label) => {
        const matchVal = label.match(regexFlagValue);
        if (matchVal) return matchVal[3];
        return '';
      });
      const unusedKeys = [];

      // 找出未設定值
      for (const key of flagKeys) {
        if (!labelIndex.includes(key)) {
          unusedKeys.push(key);
        }
      }

      // 確認潛在旗標名稱
      if (unusedKeys.length === 1) return `[*Flag.${flagId}.${flagIndex}.${unusedKeys[0]}*]`;
    } else if (cleanLabels.length === 0) {
      return index === 1 ? '[*Custom.True*]' : index === 2 ? '[*Custom.False*]' : null;
    }
    return null;
  };

  // 處理函數呼叫
  const handleCallExpression = (node, content, rel, cache, script) => {
    // 根據函數名稱進行不同處理
    const funcName = node.base.name ?? `${node.base.base?.name ?? node.base.base?.base?.name}.${node.base.identifier.name}`;
    switch (funcName) {
      // 切換場景
      case 'luamanager.ChangeScene': {
        switch (removeQuote(node.arguments[0].raw)) {
          // 預設自由行動
          case 'Free': {
            mergeRelation(rel.to, { Script: ['CS_free'] });
            content.push({ form: 'effect', type: 'Free', text: '◎[*Custom.Free*]:[*Label.Free,CS_free*]' });
            break;
          }
          // 特定自由行動
          case 'Story': {
            const script = cache?.temp.story ?? 'Unknown';
            mergeRelation(rel.to, { Script: [script] });

            // 檢查跳轉劇本
            const skip = custom[script]?.skip;
            if (skip) {
              mergeRelation(rel.to, { Script: [skip] });
              content.push({ form: 'effect', type: 'Free', text: `◎[*Custom.Free*]:[*Label.Free,${skip}*]` });
            } else content.push({ form: 'effect', type: 'Free', text: `◎[*Custom.Free*]:[*Label.Free,${script}*]` });
            break;
          }
          // 戰役
          case 'Battle': {
            const name = `BL_${removeQuote(node.arguments[1].raw)}`;
            const script = cache?.temp?.story ?? 'Unknown';
            mergeRelation(rel.to, { Script: [script], Battle: [name] });
            if (script && script !== 'Unknown' && CACHE.BATTLE?.[name]) {
              CACHE.BATTLE[name].rel ??= {};
              CACHE.BATTLE[name].rel.to ??= {};
              mergeRelation(CACHE.BATTLE?.[name]?.rel.to, { Script: [script] });
            }
            content.push({ form: 'effect', type: 'Battle', text: `★[*System.Battle*][*Label.Battle,${name}*]` });
            content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.CombatNextScript*][*Label.Script,${script}*]` });
            break;
          }
          // 決鬥
          case 'Combat': {
            const name = `CL_${removeQuote(node.arguments[1].raw)}`;
            const script = cache?.temp?.story ?? 'Unknown';
            mergeRelation(rel.to, { Script: [script], Combat: [name] });
            if (script && script !== 'Unknown') {
              if (CACHE.COMBAT?.[name]) {
                CACHE.COMBAT[name].rel ??= {};
                CACHE.COMBAT[name].rel.to ??= {};
                mergeRelation(CACHE.COMBAT[name].rel.to, { Script: [script] });
              }
              if (CACHE.COMBAT_FULL?.[name]) {
                CACHE.COMBAT_FULL[name].rel ??= {};
                CACHE.COMBAT_FULL[name].rel.to ??= {};
                mergeRelation(CACHE.COMBAT_FULL[name].rel.to, { Script: [script] });
              }
            }
            content.push({ form: 'effect', type: 'Combat', text: `★[*System.Combat*][*Label.Combat,${name}*]` });
            content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.CombatNextScript*][*Label.Script,${script}*]` });
            break;
          }
          // 彈珠台
          case 'Pinball': {
            const script = cache?.temp?.story ?? 'Unknown';
            content.push({ form: 'effect', type: 'System', text: '◎[*Custom.Pinball*]' });
            content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.GameNextScript*][*Label.Script,${script}*]` });
            break;
          }
          // 生死簿結局
          case 'GameOver': {
            const libraryId = removeQuote(node.arguments[1].raw);
            const name = `[*Label.Dead,${libraryId}*]`;
            mergeRelation(rel.post, { Dead: [libraryId] });
            content.push({ form: 'effect', type: 'Dead', text: name });
            break;
          }
          // 試玩版結局
          case 'DemoEnd':
            content.push({ form: 'effect', type: 'System', text: '◎[*Custom.DemoEnd*]' });
            break;
          // 忽略場景
          case 'Title':
            break;
          // 未確認場景
          default:
            writeLog('warn', `luamanager.ChangeScene - scene ${node.arguments[0].raw} skipped.`);
        }
        break;
      }
      // 設定接續劇本
      case 'luamanager.SetNextScript': {
        // 指定劇本
        if (node.arguments[0].type == 'StringLiteral') {
          const name = removeQuote(node.arguments[0].raw);
          mergeRelation(rel.to, { Script: [name] });

          // 檢查跳轉劇本
          const skip = custom[name]?.skip;
          if (skip) {
            mergeRelation(rel.to, { Script: [skip] });
            if (free[skip]) content.push({ form: 'effect', type: 'Free', text: `◎[*Custom.Free*]:[*Label.Free,${skip}*]` });
            else content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.NextScript*][*Label.Script,${skip}*]` });
          } else content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.NextScript*][*Label.Script,${name}*]` });
        }
        // 使用變數
        else {
          const name = custom[script]?.var?.[node.arguments[0].name] ?? cache?.var?.[node.arguments[0].name] ?? node.arguments[0].name;
          const scriptId = checkLabel(name);
          if (scriptId) {
            mergeRelation(rel.to, { Script: [scriptId] });

            // 檢查跳轉劇本
            const skip = custom[scriptId]?.skip;
            if (skip) {
              mergeRelation(rel.to, { Script: [skip] });
              if (free[skip]) content.push({ form: 'effect', type: 'Free', text: `◎[*Custom.Free*]:[*Label.Free,${skip}*]` });
              else content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.NextScript*][*Label.Script,${skip}*]` });
            } else content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.NextScript*][*Label.Script,${scriptId}*]` });
          } else content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.NextScript*]${name}` });
        }
        break;
      }
      // 預存臨時劇本變數
      case 'luamanager.SetTempScript': {
        const name = removeQuote(node.arguments[1].raw);
        const index = node.arguments[0].value;
        cache.temp[index] = name;
        mergeRelation(rel.to, { Script: [name] });
        content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.TempScript*]${index}:[*Label.Script,${name}*]` });
        break;
      }
      // 預存地圖移動變數
      case 'luamanager.SetCurrentTravelScript': {
        const name = removeQuote(node.arguments[0].raw);
        cache.temp.travel = name;
        mergeRelation(rel.to, { Script: [name] });
        content.push({ form: 'effect', type: 'Script', text: `◎[*Custom.TravelScript*]:[*Label.Script,${name}*]` });
        break;
      }
      // 預存接續劇本變數 (不輸出)
      case 'luamanager.SetCurrentStoryScript': {
        const name = removeQuote(node.arguments[0].raw);
        cache.temp.story = name;
        mergeRelation(rel.to, { Script: [name] });
        break;
      }
      // 設定遊戲時間
      case 'luamanager.SetGameTime': {
        const time = `[*Custom.GameTimeText,${node.arguments[0].value},${node.arguments[1].value},${node.arguments[2].value}*]`;
        content.push({ form: 'effect', type: 'System', text: `◎[*Custom.SetTime*]:${time}` });
        break;
      }
      // 設定遊戲時間增加一個月
      case 'luamanager.NextMonth': {
        content.push({ form: 'effect', type: 'System', text: `◎[*Custom.SetTime*]:[*Custom.After,System.Number_1,Custom.Month*]` });
        break;
      }
      // 設定遊戲時間增加一旬
      case 'luamanager.NextRound': {
        content.push({ form: 'effect', type: 'System', text: `◎[*Custom.SetTime*]:[*Custom.After,System.Number_1,Custom.Stage*]` });
        break;
      }
      // 設定任務觸發時間
      case 'luamanager.SetMissionTime': {
        const timeId = removeQuote(node.arguments[0].raw);
        const year = node.arguments[1].value ? node.arguments[1].value : '';
        const month = node.arguments[2].value ? node.arguments[2].value : '';
        const round = node.arguments[3].value ? node.arguments[3].value : '';
        let time = `[*Custom.AfterTime,${year},${year ? 'Custom.Year' : ''},${month},${month ? 'Custom.Month' : ''},${round},${round ? 'Custom.Stage' : ''}*]`;
        if (time === '[*Custom.AfterTime,,,,,,*]') time = '[*Custom.Now*]';
        const text = `◎[*Label.Time,${timeId}*][*Custom.SetTriggerTime*]:${time}`;
        content.push({ form: 'effect', type: 'Trigger', text });
        mergeRelation(rel.post, { Time: [timeId] });
        break;
      }
      // 設定戰役技能 (同分岐重複設定只輸出一次)
      case 'luamanager.SetBattleSkillActive':
      case 'luamanager.SetPlayerBattleSkill': {
        const id = removeQuote(node.arguments[0].raw);
        const charId = CACHE.SKILL[id].character;
        const text = `◎[*Custom.SetBattleSkill*][*Label.BattleSkill,${id},${charId}*]`;
        if (content.every((c) => c.text != text)) {
          content.push({ form: 'effect', type: 'BattleSkill', text });
          mergeCharacterRelation(rel.post, charId);
        }
        break;
      }
      // 設定標題畫面人物
      case 'luamanager.SetTitlePartner': {
        content.push({ form: 'effect', type: 'System', text: '◎[*Custom.SetTitlePartner*]' });
        break;
      }
      // 增減玩家屬性
      case 'statmodifymanager.Player': {
        // 記錄資訊
        const val = getArgumentValue(node.arguments[1], cache);
        const hide = node.arguments[3]?.value ? '' : '*';
        const name = `[*Label.Stat,${removeQuote(node.arguments[0].raw)}*]`;
        const extra = node.arguments[2]?.raw;
        const sign = extra == '"center"' ? '±' : !Number.isNaN(val) && val < 0 ? '' : '+';
        const mental = extra == '"mental"' ? `(☹︎${val - 1})` : '';

        // 回存內容
        content.push({ form: 'effect', type: 'Stat', text: `${hide}${name}${sign}${val}${mental}` });
        break;
      }
      // 設定玩家屬性
      case 'statmodifymanager.SetPlayer': {
        // 記錄資訊
        let val = getArgumentValue(node.arguments[1], cache);
        const name = `[*Label.Stat,${removeQuote(node.arguments[0].raw)}*]`;

        // 屬性值心上人額外處理
        if (name == '[*Label.Stat,lover*]' && !Number.isNaN(val)) {
          // 增加關聯角色
          const loverId = LOVER_MAP[val];
          if (loverId) {
            val = `[*Label.Character,${loverId}*]`;
            mergeRelation(rel.post, { Character: [loverId] });
          } else {
            val = `[*PlayerInfo.Lover.${val}*]`;
          }
        }
        // 屬性值稱號額外處理
        else if (name == '[*Label.Stat,title*]' && !Number.isNaN(val)) {
          val = `[*PlayerInfo.Title.${val}*]`;
        }

        // 回存內容
        content.push({ form: 'effect', type: 'Stat', text: `${name}=${val}` });
        break;
      }
      // 增減好感度
      case 'statmodifymanager.Character': {
        // 記錄資訊
        const val = getArgumentValue(node.arguments[1], cache);
        const hide = node.arguments[2]?.value ? '' : '*';
        const character = removeQuote(node.arguments[0].raw);
        const name = `[*Label.Relationship,${character}*]`;
        const sign = val < 0 ? '' : '+';

        // 回存內容
        mergeRelation(rel.post, { Character: [character] });
        content.push({ form: 'effect', type: 'Relationship', text: `${hide}${name}${sign}${val}` });
        break;
      }
      // 設定好感度
      case 'statmodifymanager.SetCharacter': {
        // 記錄資訊
        const val = getArgumentValue(node.arguments[1], cache);
        const character = removeQuote(node.arguments[0].raw);
        const name = `[*Label.Relationship,${character}*]`;

        // 回存內容
        mergeRelation(rel.post, { Character: [character] });
        content.push({ form: 'effect', type: 'Relationship', text: `${name}=${val}` });
        break;
      }
      // 增減旗標
      case 'statmodifymanager.AddFlag': {
        // 記錄資訊
        const val = getArgumentValue(node.arguments[1], cache);
        const flag = removeQuote(node.arguments[0].raw);
        const sign = !Number.isNaN(val) && val < 0 ? '' : '+';
        const statment = handleFlagStatement(flag, val, script, sign, true);

        // 回存內容
        mergeRelation(rel.post, { Flag: [flag] });
        content.push({ form: 'effect', type: 'Flag', text: statment.text });
        break;
      }
      // 設定旗標
      case 'statmodifymanager.SetFlag': {
        // 記錄資訊
        const val = getArgumentValue(node.arguments[1], cache);
        const flag = removeQuote(node.arguments[0].raw);
        const statment = handleFlagStatement(flag, val, script, '=', true);

        // 回存內容
        mergeRelation(rel.post, { Flag: [flag] });
        content.push({ form: 'effect', type: 'Flag', text: statment.text });
        break;
      }
      // 重置對話旗標
      case 'statmodifymanager.ResetTalkFlag': {
        content.push({ form: 'effect', type: 'Flag', text: '◎[*Custom.ResetTalkFlag*]' });
        break;
      }
      // 獲得雜物 (只有正數)
      case 'statmodifymanager.AddMisc': {
        // 記錄資訊
        const val = node.arguments[1].value;
        const id = removeQuote(node.arguments[0].raw);

        // 回存內容
        mergeRelation(rel.post, { Misc: [id] });
        content.push({ form: 'effect', type: 'Misc', text: `[*Label.Misc,${id}*]+${val}` });
        break;
      }
      // 移除雜物 (固定1個)
      case 'statmodifymanager.RemoveMisc': {
        const id = removeQuote(node.arguments[0].raw);
        mergeRelation(rel.post, { Misc: [id] });
        content.push({ form: 'effect', type: 'Misc', text: `[*Label.Misc,${id}*]-1` });
        break;
      }
      // 獲得寶物
      case 'statmodifymanager.AddSpecial': {
        const id = removeQuote(node.arguments[0].raw);
        mergeRelation(rel.post, { Special: [id] });
        content.push({ form: 'effect', type: 'Special', text: `[*Custom.Get*][*Label.Special,${id}*]` });
        break;
      }
      // 失去寶物
      case 'statmodifymanager.RemoveSpecial': {
        const id = removeQuote(node.arguments[0].raw);
        mergeRelation(rel.post, { Special: [id] });
        content.push({ form: 'effect', type: 'Special', text: `[*Custom.Lose*][*Label.Special,${id}*]` });
        break;
      }
      // 獲得書籍
      case 'statmodifymanager.AddBook': {
        const id = removeQuote(node.arguments[0].raw);
        mergeRelation(rel.post, { Book: [id] });
        content.push({ form: 'effect', type: 'Book', text: `[*Custom.Get*][*Label.Book,${id}*]` });
        break;
      }
      // 失去書籍
      case 'statmodifymanager.RemoveBook': {
        const id = removeQuote(node.arguments[0].raw);
        mergeRelation(rel.post, { Book: [id] });
        content.push({ form: 'effect', type: 'Book', text: `[*Custom.Lose*][*Label.Book,${id}*]` });
        break;
      }
      // 增減技能
      case 'statmodifymanager.AddTalent': {
        // 記錄資訊
        const val = getArgumentValue(node.arguments[1], cache);
        const id = removeQuote(node.arguments[0].raw);
        const sign = val < 0 ? '' : '+';

        // 回存內容
        mergeRelation(rel.post, { Talent: [id] });
        content.push({ form: 'effect', type: 'Talent', text: `[*Label.Talent,${id}*]${sign}${val}` });
        break;
      }
      // 獲得成就
      case 'statmodifymanager.AddAchievementLib': {
        const id = removeQuote(node.arguments[0].raw);
        mergeRelation(rel.post, { Achievement: [id] });
        content.push({ form: 'effect', type: 'Achievement', text: `[*Label.Achievement,${id}*]` });
        break;
      }
      // 添加傳記
      case 'statmodifymanager.AddStory': {
        const text = `[*Custom.Story*]「[*LegendInfo.${removeQuote(node.arguments[0].raw)}*]」`;
        content.push({ form: 'effect', type: 'Story', text: '[*Label.Story*]' });
        content.push({ form: 'perform', type: 'Story', text });
        break;
      }
      // 設定任務觸發
      case 'statmodifymanager.Mission': {
        // 記錄並處理資訊
        let text;
        const mission = removeQuote(node.arguments[0].raw);
        const trigger = removeQuote(node.arguments[1].raw);
        const label = mission == 'Main' ? '[*Custom.MainMission*]' : `[*Label.Mission,${mission}*]`;
        if (trigger == 'M0000') text = `◎${label}[*Custom.SetTrigger*]:[*System.NA*]`;
        else if (trigger == 'clear') text = `◎${label}[*Custom.SetClear*]`;
        else {
          text = `◎${label}[*Custom.SetTrigger*]:[*Label.Trigger,${trigger}*]`;
          mergeRelation(rel.to, { Trigger: [trigger] });
        }

        // 回存內容
        content.push({ form: 'effect', type: 'Trigger', text });
        break;
      }
      // 增減其他陣營向心力
      case 'statmodifymanager.ModifyEnemyTeam': {
        // 記錄資訊
        const name = `[*Label.Enemy,${removeQuote(node.arguments[0].raw)}*][*PlayerStat.team*]`;
        const val = getArgumentValue(node.arguments[1], cache);
        const hide = node.arguments[2]?.value ? '' : '*';
        const sign = val < 0 ? '' : '+';

        // 回存內容
        content.push({ form: 'effect', type: 'Enemy', text: `${hide}${name}${sign}${val}` });
        break;
      }
      // 增減其他陣營人數
      case 'statmodifymanager.ModifyEnemyPeople': {
        // 記錄資訊
        const name = `[*Label.Enemy,${removeQuote(node.arguments[0].raw)}*][*PlayerStat.people*]`;
        const val = getArgumentValue(node.arguments[1], cache);
        const hide = node.arguments[2]?.value ? '' : '*';
        const sign = val < 0 ? '' : '+';

        // 回存內容
        content.push({ form: 'effect', type: 'Enemy', text: `${hide}${name}${sign}${val}` });
        break;
      }
      // 顯示圖片
      case 'mainui.ShowPicture': {
        content.push({ form: 'effect', type: 'Perform', text: '◇[*Custom.ShowPicture*]' });
        break;
      }
      // 顯示CG
      case 'mainui.ShowBigPicture': {
        content.push({ form: 'effect', type: 'Perform', text: '◇[*Custom.ShowCG*]' });
        break;
      }
      // 顯示系譜表
      case 'mainui.ShowFamilyTree': {
        content.push({ form: 'effect', type: 'Perform', text: '◇[*Custom.ShowTree*]' });
        break;
      }
      // 顯示大地圖移動
      case 'mainui.ShowMap': {
        content.push({ form: 'effect', type: 'Perform', text: '◇[*Custom.ShowMap*]' });
        break;
      }
      // 汗青書結局
      case 'endgamepanel.Open': {
        const id = removeQuote(node.arguments[0].raw);
        mergeRelation(rel.post, { End: [id] });
        content.push({ form: 'effect', type: 'End', text: `[*Label.End,${id}*]` });
        break;
      }
      // 顯示結局CG
      case 'cgpanel.Open': {
        content.push({ form: 'effect', type: 'Perform', text: '◇[*Custom.ShowEndCG*]' });
        break;
      }
      // 顯示動畫CG
      case 'cgvideopanel.Open': {
        content.push({ form: 'effect', type: 'Perform', text: '◇[*Custom.ShowVideoCG*]' });
        break;
      }
      // 顯示動畫
      case 'anim.Play': {
        content.push({ form: 'effect', type: 'Perform', text: '◇[*Custom.ShowVideo*]' });
        break;
      }
      // 顯示開發者名單
      case 'creditpanel.Open': {
        content.push({ form: 'effect', type: 'System', text: '◎[*Custom.ShowCredit*]' });
        break;
      }
      // 開啟繼承面板
      case 'fatebonuspanel.Open': {
        content.push({ form: 'effect', type: 'System', text: '◎[*Custom.BonusPanel*]' });
        break;
      }
      // 開啟商店面板
      case 'shoppanel.Open': {
        content.push({ form: 'effect', type: 'System', text: '◎[*Custom.ShopPanel*]' });
        break;
      }
      // 開啟修練面板
      case 'martialpanel.Open': {
        content.push({ form: 'effect', type: 'System', text: '◎[*Custom.MartialPanel*]' });
        break;
      }
      // 開啟鍛造面板
      case 'weaponupgradepanel.Open': {
        content.push({ form: 'effect', type: 'System', text: '◎[*Custom.WeaponPanel*]' });
        break;
      }
      // 開啟煉丹面板
      case 'poisonupgradepanel.Open': {
        content.push({ form: 'effect', type: 'System', text: '◎[*Custom.PoisonPanel*]' });
        break;
      }
      // 立繪調整
      case 'characters.UnloadCharacterAsset': {
        content.push({ form: 'effect', type: 'Info', text: '※[*Custom.ArtChange*]' });
        break;
      }
      // 解析子函式
      case 'runwait': {
        handleCallExpression(node.arguments[0], content, rel, cache, script);
        break;
      }
      // 對話輸出
      case 'say': {
        // 記錄資訊
        const id = removeQuote(node.arguments[0]?.arguments[0].raw ?? node.arguments[0].raw);
        const type = cache?.say?.type ?? 'unknown';
        const character = cache?.say?.character ?? '[*Character.unknown*]';
        const text = `${character}[*DialogType.${type}*]「[*Story.${id}*]」`;

        // 回存內容
        content.push({ form: 'perform', type: 'Say', text });
        cache.say = {};
        break;
      }
      // 記錄對話分類 (不輸出)
      case 'setsaydialog': {
        cache.say.type = node.arguments[0].identifier.name;
        break;
      }
      // 記錄對話角色 (不輸出)
      case 'setcharacter': {
        const id = node.arguments[0].name ?? node.arguments[0].arguments[0].raw;
        if (id == 'narrative') cache.say.character = '';
        else {
          const character = removeQuote(id);
          cache.say.character = `[*Character.${character}*]`;
          mergeCharacterRelation(rel.intra, character);
        }
        break;
      }
      // 記錄選單標題 (不輸出)
      case 'setmenudialog': {
        cache.branch = { text: '', label: [], condition: [] };
        const type = node.arguments[0].identifier.name;
        if (type == 'Options') {
          cache.branch.type = 'Option';
        } else if (type == 'Dice') {
          cache.branch.type = 'Dice';
        } else if (type == 'Talk' || type == 'Meet') {
          cache.branch.type = 'Talk';
        } else if (positionList.includes(type) || type.startsWith('Section')) {
          cache.branch.type = 'Position';
        } else {
          cache.branch.type = 'Unknown';
          writeLog('warn', `Function "setmenudialog" - type "${type}" skipped.`);
        }
        break;
      }
      // 顯示/移動角色
      case 'stage.show': {
        // 記錄資訊
        let name = 'unknown';
        let fromPosition, toPosition, text;
        for (const field of node.arguments.fields) {
          if (field.key.name == 'character') name = removeQuote(field.value.arguments[0].raw);
          else if (field.key.name == 'fromPosition') fromPosition = field.value.raw;
          else if (field.key.name == 'toPosition') toPosition = field.value.raw;
        }

        // 回存內容
        if (toPosition) {
          mergeCharacterRelation(rel.intra, name);
          name = `[*Character.${name}*]`;
          if (fromPosition == toPosition) text = `※[*Custom.ShowCharacter*]:${name}`;
          else text = `※[*Custom.MoveCharacter*]:${name}`;
          content.push({ form: 'perform', type: 'Character', text });
        } else {
          content.push({ form: 'perform', type: 'Character', text: `※[*Custom.AdjustCharacter*]:${name}` });
        }
        break;
      }
      // 隱藏角色
      case 'stage.hide': {
        let name = 'unknown';
        for (const field of node.arguments.fields) {
          if (field.key.name == 'character') {
            name = removeQuote(field.value.arguments[0].raw);
            break;
          }
        }
        content.push({ form: 'perform', type: 'Character', text: `※[*Custom.HideCharacter*]:[*Character.${name}*]` });
        break;
      }
      case 'effects.SetupEffect': {
        content.push({ form: 'perform', type: 'Effect', text: `※[*Custom.SetupEffect*]` });
        break;
      }
      case 'flowcharts.LoadView': {
        content.push({ form: 'perform', type: 'Effect', text: `※[*Custom.LoadView*]` });
        break;
      }
      // 忽略函式
      case 'luamanager.PlayMusic':
      case 'luamanager.StopMusic':
      case 'luamanager.FadeOutMusic':
      case 'luamanager.PlaySound':
      case 'luamanager.PlayEnvSound':
      case 'luamanager.FadeOutEnvSound':
      case 'luamanager.SetGameDayEnvironment':
      case 'luamanager.ToggleSaveButton':
      case 'luamanager.PrologueSave':
      case 'luamanager.AutoSave':
      case 'luamanager.AutoFreeSave':
      case 'luamanager.ResetBattleSkill':
      case 'luamanager.SetEnableActions':
      case 'luamanager.SwapUpgradeItem':
      case 'luamanager.CloseDialog':
      case 'luamanager.Init':
      case 'statmodifymanager.IsTriggerSubMission':
      case 'statmodifymanager.UpdateSetPlayerStat':
      case 'statmodifymanager.UpdateShopFlag':
      case 'statmodifymanager.ModifyEnemyId':
      case 'statmodifymanager.ModifyEnemyLevel':
      case 'mainui.DisplayMessage':
      case 'mainui.DisplayTitle':
      case 'mainui.HideBigPicture':
      case 'mainui.HideFamilyTree':
      case 'mainui.HideItemPicture':
      case 'mainui.HideMap':
      case 'mainui.HidePicture':
      case 'mainui.ShowItemPicture':
      case 'mainui.DisplayItemMessage':
      case 'anim.Stop':
      case 'shoppanel.NewShop':
      case 'characters.LoadCharacterAsset':
      case 'characters.LoadCharacterPortrait':
      case 'characters.Focus':
      case 'characters.MoveOffset':
      case 'characters.MoveOffsetCoroutine':
      case 'characters.Rotate':
      case 'characters.Shake':
      case 'characters.TestLoadCharacter':
      case 'characters.RestoreRotation':
      case 'characters.ResetRotation':
      case 'dicemenudialog.SetRandom':
      case 'dicemenudialog.Setup':
      case 'dicemenudialog.ExecuteRoll':
      case 'flowcharts.SetViewScrollSpeed':
      case 'intropanel.Show':
      case 'maincamera.ActiveVolume':
      case 'maincamera.FadeVolume':
      case 'menudialogs.SetActive':
      case 'movieblack.FadeIn':
      case 'movieblack.FadeOut':
      case 'os_mask.SetLastPosition':
      case 'os_mask.Show':
      case 'stage.showPortrait':
      case 'topmaskgradient.Show':
      case 'transitionblack.TransitionIn':
      case 'transitionblack.TransitionOut':
      case 'runblock':
      case 'wait':
        break;
      // 未確認函式
      default:
        writeLog('warn', `Function "${funcName}" skipped.`);
    }
  };

  // 處理賦值
  const handleAssignmentStatement = (node, rel, cache, script) => {
    const varType = node.variables[0].type;
    const varName = node.variables[0].name;
    const initNode = node.init[0];

    switch (varType) {
      case 'Identifier': {
        switch (initNode.type) {
          case 'CallExpression':
          case 'MemberExpression': {
            // 根據函數名稱進行不同處理
            const funcName = initNode.base?.name ?? `${initNode.base?.base?.name}.${initNode.base?.identifier?.name}`;
            switch (funcName) {
              // 記錄取得屬性值
              case 'luamanager.GetStatData': {
                const name = removeQuote(initNode.arguments[0].raw);
                if (name == 'faction-contribution') {
                  cache.var[varName] = 50 * (initNode.arguments[1].value ?? initNode.arguments[1].argument.value * -1);
                } else cache.var[varName] = `[*Label.Stat,${name}*]`;
                break;
              }
              // 記錄取得預存事件
              case 'luamanager.GetTempScript': {
                const index = initNode.arguments[0].value;
                cache.var[varName] = addLabel(cache.temp?.[index]) ?? `[*Custom.TempScript*]${index}`;
                break;
              }
              // 記錄取得地圖預存事件
              case 'luamanager.GetCurrentTravelScript': {
                cache.var[varName] = addLabel(cache.temp?.travel) ?? `[*Custom.TravelScript*]`;
                break;
              }
              // 記錄選項有效條件
              case 'checkpointmanager.Condition': {
                const id = removeQuote(initNode.arguments[0].raw);
                if (id === 'XXX') {
                  cache.condition[varName] = '[*Custom.InvalidOption*]';
                } else {
                  const obj = CACHE.CONDITION?.[id] ?? { name: `[*Custom.InvalidCondition,${id}*]` };
                  mergeRelation(rel.pre, obj?.rel?.pre ?? {});
                  cache.condition[varName] = convertXFlag(obj.name, script);
                }
                break;
              }
              // 記錄骰子資訊
              case 'checkpointmanager.Dice': {
                const id = removeQuote(initNode.arguments[0].raw);
                const obj = CACHE.DICE?.[id] ?? { bonus: [] };
                mergeRelation(rel.pre, obj?.rel?.pre ?? {});
                cache.branch.text = [`D${cache.branch.diceMax}`, ...obj.bonus].join(' / ');
                break;
              }
              // 記錄分岐資訊
              case 'checkpointmanager.Switch': {
                const id = removeQuote(initNode.arguments[0].raw);
                const obj = CACHE.SWITCH?.[id] ?? { check: `[*Custom.InvalidCheck,${id}*]`, switch: [] };
                mergeRelation(rel.pre, obj?.rel?.pre ?? {});
                cache.branch = { type: 'Switch', text: convertXFlag(obj.check, script, 'check'), label: obj.switch.map((s) => convertXFlag(s, script, 'switch')), condition: [] };
                cache.branch.label.unshift(null);
                break;
              }
              // 記錄隨機地點資訊
              case 'checkpointmanager.Position': {
                const id = removeQuote(initNode.arguments[0].raw);
                mergeRelation(rel.to, { Position: [id] });
                cache.var[varName] = `[*Custom.Random*][*Label.Position,${id}*][*System.StoryEvent*]`;
                break;
              }
              // 記錄隨機值
              case 'math.random': {
                // 記錄骰子上限
                if (varName.includes('dice')) cache.branch.diceMax = initNode.arguments[0].value;
                // 記錄通用變數
                else if (varName.includes('var')) cache.var[varName] = `[*Custom.Random*]1~${initNode.arguments[0].value}`;
                break;
              }
              // 忽略函式
              case 'choose':
              case 'dicemenudialog':
                break;
              default:
                writeLog('warn', `AssignmentStatement - Function "${funcName}" skipped.`);
            }
            break;
          }
          case 'StringLiteral': {
            // 記錄劇本ID
            cache.var[varName] = addLabel(removeQuote(initNode.raw));
            break;
          }
          // 忽略分類
          case 'TableConstructorExpression':
            break;
          // 未確認分類
          default:
            writeLog('warn', `AssignmentStatement - "${initNode.type}" skipped.`);
        }
        break;
      }
      case 'IndexExpression': {
        const index = node.variables[0].index.value;
        const condition = initNode?.left?.left?.name ?? initNode?.left?.name;
        const raw = condition ? (initNode.left?.right?.raw ?? initNode?.right?.raw) : initNode.raw;

        // 記錄分歧標籤及額外條件
        switch (cache?.branch?.type) {
          case 'Option': {
            cache.branch.label[index] = `[*Story.${removeQuote(raw)}*]`;
            break;
          }
          case 'Dice': {
            const matched = raw.match(regexDice);
            if (matched) {
              const symbol = matched[2].replace(regexGE, '≥').replace(regexLE, '≤');
              cache.branch.label[index] = `${symbol}${matched[3]} [*Story.${matched[1]}*]`;
            }
            break;
          }
          case 'Talk':
          case 'Position': {
            const term = removeQuote(raw).split('+');
            if (term.length === 4) {
              cache.branch.label[index] = `[*Middle.${term[0]}*]｜[*Story.${term[1]}*]`;
            } else {
              cache.branch.label[index] = `[*Position.type.${term[1]}*]｜[*Position.title.${term[2]}*]`;
            }
            break;
          }
          default:
            writeLog('warn', `AssignmentStatement - branch type "${cache?.branch?.type}" skipped.`);
        }
        cache.branch.condition[index] = condition ? (cache.condition?.[condition] ?? `[*Custom.InvalidCondition,${condition}*]`) : null;
        break;
      }
      case 'MemberExpression':
        // 均忽略
        break;
    }
  };

  // 處理分歧判斷
  const handleIfStatement = (node, content, cache, walk) => {
    // 記錄資訊
    const type = cache?.branch?.type ?? 'Unknown';
    const text = `[*BranchType.${type}*]：${cache?.branch?.text ?? ''}`;
    const branch = { form: 'branch', type, text, branches: [] };

    // 遍歷分歧項目
    node.clauses.forEach((clause) => {
      // 重置暫存，淺拷貝變數暫存
      const subContent = [];
      const subCache = { say: {}, branch: {}, condition: {}, temp: { ...cache.temp }, var: { ...cache.var } };

      // 記錄資訊
      const index = clause?.condition?.right?.value ?? 0;
      // const label = cache.branch.label[index] ?? (index == 1 ? '[*Custom.True*]' : index == 2 ? '[*Custom.False*]' : '[*Custom.Other*]');
      const label = cache.branch.label[index] ?? getPotentialBranchLabel(cache.branch?.text ?? '', cache.branch.label, index) ?? '[*Custom.Other*]';

      // 遞迴解析分歧
      walk(clause.body, subContent, subCache);

      // 回存
      const condition = cache.branch.condition[index];
      const branchObj = { index, text: label, content: subContent };
      if (condition) branchObj.condition = condition;
      branch.branches.push(branchObj);
    });

    // 回存結果
    content.push(branch);
    cache.branch = { label: [], condition: [] };
  };

  // 主流程
  const process = async (file) => {
    try {
      // 解析lua檔案為AST
      const luaCode = await readFile(path.join(folder, file), 'utf-8');
      const ast = luaparse.parse(luaCode, { comments: false });

      // FOR TEST
      // await exportJson(ast, removeExt(file), 'lua');

      // 紀錄資訊
      const id = removeExt(file);
      const script = {
        content: [],
        rel: { pre: custom?.[id]?.rel?.pre ?? {}, post: custom?.[id]?.rel?.post ?? {}, intra: custom?.[id]?.rel?.intra ?? {}, to: custom?.[id]?.rel?.to ?? {} },
        remark: Array.from(custom?.[id]?.remark ?? [], (_, i) => `[*Script.Remark.${id}.${i}*]`)
      };
      if (custom?.[id]?.timeCheck) script.timeCheck = custom?.[id]?.timeCheck;
      if (custom?.[id]?.skip) script.skip = custom?.[id]?.skip;
      updateNameDraftItem(nameDraft, id);

      // 變數暫存
      const initCache = { say: {}, branch: {}, condition: {}, temp: {}, var: {} };

      // AST 走訪器
      const walk = (node, content, cache) => {
        if (!node) return;

        // 遍歷陣列
        if (Array.isArray(node)) {
          node.forEach((n) => walk(n, content, cache));
          return;
        }

        switch (node.type) {
          case 'CallStatement':
            // 處理函式呼叫
            handleCallExpression(node.expression, content, script.rel, cache, id);
            break;
          case 'IfStatement':
            // 處理分歧判斷
            handleIfStatement(node, content, cache, walk);
            break;
          case 'AssignmentStatement':
          case 'LocalStatement':
            // 處理變數賦值
            handleAssignmentStatement(node, script.rel, cache, id);
            break;
          default:
            // 忽略節點
            break;
        }
      };

      // 啟動解析
      walk(ast.body, script.content, initCache);

      // 自訂內容覆蓋
      if (fullCustom?.[id]?.content) script.content = fullCustom[id].content;

      // 回存結果
      const logic = buildLogicView(script.content);
      result[id] = script;
      logicResult[id] = { ...script, content: logic.content, effects: logic.effects };
    } catch (err) {
      writeLog('error', `Parsing script "${file}" failed.`, err.stack);
    }
  };

  // 並行處理主流程
  await Promise.all(files.map(process));
  writeLog('log', '"Script" parsed successfully!');

  // 並行輸出結果
  await Promise.all([exportJson(result, 'scriptFull'), exportJson(logicResult, 'script'), exportJson(nameDraft, 'scriptName'), exportJson(CACHE.BATTLE, 'battle'), exportJson(CACHE.COMBAT, 'combat'), exportJson(CACHE.COMBAT_FULL, 'combatFull')]);
  CACHE.SCRIPT = logicResult;
  CACHE.SCRIPT_FULL = result;
  CACHE_FULFILL.SCRIPT = true;
}

// 整理最終資料，建立反向關聯並輸出
export async function organizeOutputData() {
  // 載入Cache
  const [free] = await Promise.all([
    getDataJson('scriptFree'),
    loadCache(['MISC', 'SPECIAL', 'EFFECT', 'TALENT', 'FLAG', 'TERM', 'BOOK', 'EQUIP', 'GROUP', 'MISSION', 'TRIGGER', 'POSITION', 'CONDITION', 'SWITCH', 'DICE', 'COMBAT', 'BATTLE', 'SCRIPT'])
  ]);

  // 初始化
  const regexTerm = /\[\*[\s\S]+?\*\]/g;
  const reverseType = { post: 'pre', pre: 'post', intra: 'inter', inter: 'intra', from: 'to', to: 'from' };

  // Helper: 首字大寫
  const capitalize = (str) => `${str.charAt(0).toUpperCase()}${str.slice(1).toLowerCase()}`;

  // Helper: 加入反向關聯
  const addBackRelation = (sourceCat, sourceId, targetCat, targetId, type) => {
    targetCat = targetCat.toUpperCase();
    sourceCat = capitalize(sourceCat);
    const target = CACHE[targetCat]?.[targetId] ?? CACHE[targetCat]?.[targetId.toLowerCase()];
    if (target) {
      target.rel ??= {};
      target.rel[type] ??= {};
      mergeRelation(target.rel[type], { [sourceCat]: [sourceId] });

      // 一併更新完整版
      targetCat = `${targetCat}_FULL`;
      const targetFull = CACHE?.[targetCat]?.[targetId];
      if (targetFull) {
        targetFull.rel ??= {};
        targetFull.rel[type] ??= {};
        mergeRelation(targetFull.rel[type], { [sourceCat]: [sourceId] });
      }
    } else writeLog('warn', `${sourceCat} - ${sourceId} - ${targetCat} - ${targetId} not found.`);
  };

  // 遍歷各類資料
  const scurceCats = ['TALENT', 'EFFECT', 'BOOK', 'EQUIP', 'MISSION', 'TRIGGER', 'POSITION', 'BATTLE', 'COMBAT', 'SCRIPT'];
  for (const sourceCat of scurceCats) {
    for (const [sourceId, data] of Object.entries(CACHE[sourceCat])) {
      // 遍歷各類關聯
      for (const type of ['pre', 'intra', 'post', 'inter', 'from', 'to']) {
        for (const [targetCat, targetIds] of Object.entries(data?.rel?.[type] ?? {})) {
          for (const targetId of targetIds) {
            // 跳過自由行動類
            if (free[targetId] && type === 'to') continue;

            // 加入反向關聯
            addBackRelation(sourceCat, sourceId, targetCat, targetId, reverseType[type]);
          }
        }
      }
    }
  }

  // 自訂排序 (無字 < 字母 < 數字)
  const termWeight = { start: 1, option: 2, break: 3, work: 4, exit: 5 };
  const customSort = (a, b) => {
    const partsA = a.replace('_f_', '_01_00_').split('_');
    const partsB = b.replace('_f_', '_01_00_').split('_');
    const len = Math.min(partsA.length, partsB.length);

    for (let i = 0; i < len; i++) {
      const pA = partsA[i];
      const pB = partsB[i];

      if (pA !== pB) {
        const isNumA = /^\d+$/.test(pA);
        const isNumB = /^\d+$/.test(pB);

        // 字母優先於數字
        if (isNumA !== isNumB) return isNumA ? 1 : -1;

        // 同為字母或字串，優先檢查特定關鍵字權重
        if (!isNumA) {
          const weightA = termWeight[pA] ?? 99;
          const weightB = termWeight[pB] ?? 99;

          if (weightA !== weightB) return weightA - weightB;
        }

        // 自然排序
        return pA.localeCompare(pB, undefined, { numeric: true, sensitivity: 'base' });
      }
    }
    // 長度短的排前面
    return partsA.length - partsB.length;
  };

  // Helper: 轉換時間物件為比較用數值 (如 2年11月2旬 -> 21102)
  const toTimestamp = (y, m, s) => {
    const year = parseInt(y, 10);
    const month = parseInt(m, 10);
    const stage = parseInt(s, 10);
    if (isNaN(year) || isNaN(month) || isNaN(stage)) return null;
    return year * 10000 + month * 100 + stage;
  };

  // Helper: 檢查腳本時間與 Trigger 觸發時間是否有交集
  const checkTimeOverlap = (triggerMin, triggerMax, timeCheck) => {
    if (!timeCheck || timeCheck.length === 0) return true;

    // Trigger 時間區間
    const trigMin = toTimestamp(triggerMin?.year, triggerMin?.month, triggerMin?.stage) ?? 0;
    const trigMax = toTimestamp(triggerMax?.year, triggerMax?.month, triggerMax?.stage) ?? Infinity;

    // Script 條件解析為區間
    let scriptMin = 0;
    let scriptMax = Infinity;
    const notEquals = [];

    for (const c of timeCheck) {
      const t = toTimestamp(c.year, c.month, c.stage);
      if (!t) continue;

      switch (c.logic) {
        case 'GreaterEqual':
          scriptMin = Math.max(scriptMin, t);
          break;
        case 'Greater':
          scriptMin = Math.max(scriptMin, t + 1);
          break;
        case 'LessEqual':
          scriptMax = Math.min(scriptMax, t);
          break;
        case 'Less':
          scriptMax = Math.min(scriptMax, t - 1);
          break;
        case 'Equal':
          scriptMin = Math.max(scriptMin, t);
          scriptMax = Math.min(scriptMax, t);
          break;
        case 'NotEqual':
          notEquals.push(t);
          break;
      }
    }

    if (scriptMin > scriptMax) return false;

    // 計算兩個時間區間是否有交集
    const overlapMin = Math.max(trigMin, scriptMin);
    const overlapMax = Math.min(trigMax, scriptMax);

    if (overlapMin > overlapMax) return false;

    // 排除特殊狀況：若交集剛好只有一個確切時間點，且該時間被 NotEqual 排除，則無交集
    if (overlapMin === overlapMax && notEquals.includes(overlapMin)) {
      return false;
    }

    return true;
  };

  // 劇本來源深度追溯
  const traceOrigin = (category, itemId, origins, relVisited, flowVisited, scriptSet, subEventMap, canCollectFlow = true) => {
    const visitKey = `${category}:${itemId}`;
    const nodeData = CACHE[category.toUpperCase()]?.[itemId];
    if (!nodeData) return;

    // 跳過自由行動類
    if (category === 'Script' && itemId in free && origins?.type !== 'Free') return;

    // 跳過無時間交集的劇本
    if (category === 'Script' && nodeData.timeCheck) {
      if (!checkTimeOverlap(origins.minTime, origins.maxTime, nodeData.timeCheck)) {
        return;
      }
    }

    // DAG 訪問剪枝判斷
    const alreadyRel = relVisited.has(visitKey);
    const alreadyFlow = flowVisited.has(visitKey);

    if (!canCollectFlow && alreadyRel) return;
    if (canCollectFlow && alreadyFlow) return;

    // 建立反向關聯
    if (!alreadyRel) {
      relVisited.add(visitKey);
      if (origins.triggerId) addBackRelation('TRIGGER', origins.triggerId, category, itemId, 'from');
      if (origins.missionId) addBackRelation('MISSION', origins.missionId, category, itemId, 'from');
      if (origins.positionId) addBackRelation('POSITION', origins.positionId, category, itemId, 'from');
    }

    // 判斷終止節點與 Flow 收集
    const isTerminated = origins.stopFlow?.has(itemId);
    const nextCanCollect = canCollectFlow && !isTerminated;

    if (canCollectFlow) {
      flowVisited.add(visitKey);
      if (!isTerminated) {
        if (category === 'Script') {
          scriptSet.add(itemId);
        } else if (category === 'Combat' || category === 'Battle') {
          subEventMap.set(itemId, { id: itemId, type: category });
        }
      }
    }

    // 遞迴後續節點
    const toRels = nodeData.rel?.to ?? {};
    for (const nextScript of toRels.Script ?? []) {
      traceOrigin('Script', nextScript, origins, relVisited, flowVisited, scriptSet, subEventMap, nextCanCollect);
    }
    for (const nextCombat of toRels.Combat ?? []) {
      traceOrigin('Combat', nextCombat, origins, relVisited, flowVisited, scriptSet, subEventMap, nextCanCollect);
    }
    for (const nextBattle of toRels.Battle ?? []) {
      traceOrigin('Battle', nextBattle, origins, relVisited, flowVisited, scriptSet, subEventMap, nextCanCollect);
    }
  };

  const regexScriptPrefix = /\w+?(?=_(?:start|option|break|work|exit)|$)/;
  const regexScriptSubPrefix = /\w+?(?=_|$)/;

  // Helper: 建立事件流
  const buildEventFlow = (initScript, scriptSet, subEventMap, flowOrder = {}) => {
    if (!initScript) return [];

    const initScriptPrefix = initScript.match(regexScriptPrefix)?.[0] ?? initScript;
    const initScriptSubPrefix = initScript.match(regexScriptSubPrefix)?.[0] ?? initScript;

    // 全域分流
    const nearestScripts = [];
    const nearScripts = [];
    const otherScripts = [];
    for (const s of scriptSet) {
      if (s === initScript) continue;
      if (s in flowOrder) continue;

      if (initScriptPrefix && s.startsWith(initScriptPrefix)) nearestScripts.push(s);
      else if (initScriptSubPrefix && s.startsWith(initScriptSubPrefix)) nearScripts.push(s);
      else otherScripts.push(s);
    }

    // 基礎 Script 骨幹排序
    const sortedScripts = [initScript, ...nearestScripts.sort(customSort), ...nearScripts.sort(customSort), ...otherScripts.sort(customSort)].filter(Boolean);

    // 循序檢查並插入自訂 flowOrder 腳本
    for (const [scriptId, rule] of Object.entries(flowOrder)) {
      if (!scriptSet.has(scriptId)) continue;

      const anchor = rule.after ?? rule.before;
      const isAfter = 'after' in rule;

      // 防呆：先移除避免重複存在
      const existIdx = sortedScripts.indexOf(scriptId);
      if (existIdx !== -1) sortedScripts.splice(existIdx, 1);

      const anchorIdx = sortedScripts.indexOf(anchor);
      if (anchorIdx !== -1) {
        sortedScripts.splice(isAfter ? anchorIdx + 1 : anchorIdx, 0, scriptId);
      } else {
        // 找不到錨點時安全追加至末尾
        sortedScripts.push(scriptId);
      }
    }

    // 生成純 Script 的事件流基礎陣列 (過濾 skip 腳本)
    const eventFlow = [];
    for (const s of sortedScripts) {
      const nodeData = CACHE.SCRIPT[s];
      if (!nodeData || !nodeData.skip) {
        eventFlow.push({ id: s, type: 'Script' });
      }
    }

    // 將 Combat / Battle 插入至接續 Script 前面
    const subEvents = Array.from(subEventMap.values()).sort((a, b) => customSort(a.id, b.id));
    for (const ev of subEvents) {
      const cat = ev.type.toUpperCase();
      const node = CACHE[cat]?.[ev.id];

      // 優先從自身 rel.to 尋找屬於當前事件流的接續腳本
      const nextScripts = node?.rel?.to?.Script ?? [];
      let targetScript = nextScripts.find((s) => scriptSet.has(s));

      // 若自身未記錄，退回從觸發的前置腳本 rel.to 尋找
      const fromScriptId = node?.rel?.from?.Script?.[0];
      if (!targetScript && fromScriptId) {
        const fromNextScripts = CACHE.SCRIPT[fromScriptId]?.rel?.to?.Script ?? [];
        targetScript = fromNextScripts.find((s) => scriptSet.has(s));
      }

      const targetIdx = targetScript ? eventFlow.findIndex((item) => item.id === targetScript && item.type === 'Script') : -1;

      if (targetIdx !== -1) {
        // 插在接續 Script 前面
        eventFlow.splice(targetIdx, 0, ev);
      } else {
        // 安全插在觸發該戰鬥的前置腳本後面
        const fromIdx = fromScriptId ? eventFlow.findIndex((item) => item.id === fromScriptId && item.type === 'Script') : -1;
        if (fromIdx !== -1) {
          eventFlow.splice(fromIdx + 1, 0, ev);
        } else {
          eventFlow.push(ev);
        }
      }
    }

    return eventFlow;
  };

  // 遍歷任務觸發呼叫來源深度追溯，並建立 eventFlow
  for (const [triggerId, triggerData] of Object.entries(CACHE.TRIGGER ?? {})) {
    const initScript = triggerData?.script ?? null;
    const origins = {
      triggerId: triggerId,
      missionId: triggerData.mission,
      minTime: triggerData.minTime,
      maxTime: triggerData.maxTime,
      type: triggerData.type,
      stopFlow: new Set(triggerData.stopFlow ?? [])
    };

    const scriptSet = new Set();
    const subEventMap = new Map();
    const relVisited = new Set();
    const flowVisited = new Set();

    if (initScript) traceOrigin('Script', initScript, origins, relVisited, flowVisited, scriptSet, subEventMap, true);
    const eventFlow = triggerData?.eventFlow ?? buildEventFlow(initScript, scriptSet, subEventMap, triggerData?.flowOrder ?? {});
    if (eventFlow.length > 0) triggerData.eventFlow = eventFlow;
  }

  // 遍歷隨機地點事件呼叫來源深度追溯，並建立 eventFlow
  for (const [positionId, positionData] of Object.entries(CACHE.POSITION ?? {})) {
    for (const [eventId, eventData] of Object.entries(positionData.event ?? {})) {
      const initScript = eventData.script ?? null;
      const origins = { positionId: positionId, stopFlow: new Set(eventData?.stopFlow ?? []) };

      const scriptSet = new Set();
      const subEventMap = new Map();
      const relVisited = new Set();
      const flowVisited = new Set();

      if (initScript) traceOrigin('Script', initScript, origins, relVisited, flowVisited, scriptSet, subEventMap, true);

      const eventFlow = eventData?.eventFlow ?? buildEventFlow(initScript, scriptSet, subEventMap, eventData?.flowOrder ?? {});
      if (eventFlow.length > 0) eventData.eventFlow = eventFlow;
    }
  }

  // 製作搜尋/索引
  const searchCats = ['SCRIPT', 'TRIGGER', 'POSITION', 'COMBAT', 'BATTLE'];
  for (const cat of searchCats) {
    for (const [sourceId, data] of Object.entries(CACHE[cat])) {
      const keywords = new Set();

      // 擷取內容關鍵字
      const contents = ['content', 'friend', 'enemy', 'neutral', 'condition'];
      for (const content of contents) {
        if (data[content]) {
          const contentStr = JSON.stringify(data[content]);
          const contentTerms = contentStr.match(regexTerm);
          for (const term of contentTerms ?? []) keywords.add(term);
        }
      }

      // 擷取事件關鍵字
      if (data.mission) {
        keywords.add(`[*Mission.Name.${data.mission}*]`);
      }
      if (data.script) {
        keywords.add(`[*Script.Name.${data.script}*]`);
      }
      if (data.event) {
        for (const eventData of Object.values(data.event) ?? []) {
          keywords.add(eventData.script);
          keywords.add(`[*Script.Name.${eventData.script}*]`);
        }

        const contentStr = JSON.stringify(data.event);
        const contentTerms = contentStr.match(regexTerm);
        for (const term of contentTerms ?? []) keywords.add(term);
      }

      // 擷取登場角色關鍵字
      for (const characterId of data?.rel?.intra?.Character ?? []) {
        keywords.add(`[*Label.Character,${characterId}*]`);
      }

      // 回存檢索用字串
      const searchText = Array.from(keywords).join(',');
      if (cat === 'SCRIPT') {
        CACHE.SCRIPT_INDEX[sourceId] = { searchText };
        if (free[sourceId]) CACHE.SCRIPT_FREE[sourceId] = { searchText };
      } else CACHE[cat][sourceId].searchText = searchText;
    }
  }

  // 更新json檔案
  const exportCats = [
    'MISC',
    'SPECIAL',
    'EFFECT',
    'TALENT',
    'FLAG',
    'CHARACTER',
    'END',
    'ACHIEVEMENT',
    'DEAD',
    'BOOK',
    'EQUIP',
    'GROUPSTAT',
    'TIME',
    'MISSION',
    'TRIGGER',
    'POSITION',
    'COMBAT',
    'BATTLE',
    'SCRIPT'
  ];
  for (const category of exportCats) {
    const exportPromises = [];
    const catName = category.toLowerCase();
    exportPromises.push(exportJson(CACHE[category], 'all', `public/data/${catName}`, true, false));
    for (const [itemId, itemData] of Object.entries(CACHE[category] ?? {})) {
      exportPromises.push(exportJson(itemData, itemId, `public/data/${catName}`, true, false));
    }

    // 嘗試輸出完整版
    const categoryFull = `${category}_FULL`;
    if (CACHE[categoryFull]) {
      exportPromises.push(exportJson(CACHE[categoryFull], 'all', `public/full/data/${catName}`, true, false));
      for (const [itemId, itemData] of Object.entries(CACHE[categoryFull])) {
        exportPromises.push(exportJson(itemData, itemId, `public/full/data/${catName}`, true, false));
      }
    }

    // 劇本額外處理
    if (category === 'SCRIPT') {
      exportPromises.push(exportJson(CACHE.SCRIPT_INDEX, 'index', 'public/data/script', true, false));
      exportPromises.push(exportJson(CACHE.SCRIPT_FREE, 'index_free', 'public/data/script', true, false));
    }
    await Promise.all(exportPromises);
  }
  writeLog('log', '"Data" organized successfully!');
}

// 收尾整理在地化用詞表
export async function parseLocalization() {
  // 初始化
  const regexHan = /\p{Script=Han}/u;
  const regexEnd = /\/_$/;
  const regexEnd0 = /(\/0)?\/$/;
  const converter = OpenCC.Converter({ from: 'twp', to: 'cn' });

  // 讀取來源
  const [
    battleName,
    combatName,
    combatCustom,
    triggerCustom,
    missionCustom,
    missionName,
    scriptCustom,
    scriptFree,
    scriptName,
    groupCustom,
    option,
    dialog,
    flagCustom,
    termCustom,
    term,
    position,
    about
  ] = await Promise.all([
    getDataJson('battleName'),
    getDataJson('combatName'),
    getDataJson('combatCustom'),
    getDataJson('triggerCustom'),
    getDataJson('missionCustom'),
    getDataJson('missionName'),
    getDataJson('scriptCustom'),
    getDataJson('scriptFree'),
    getDataJson('scriptName'),
    getDataJson('groupCustom'),
    getDataJson('option'),
    getDataJson('dialog', ''),
    getDataJson('flagCustom'),
    getDataJson('termCustom'),
    getDataJson('term', ''),
    getDataJson('position', ''),
    getDataJson('about')
  ]);

  // Helper: 檢查物件
  const isObject = (item) => item && typeof item === 'object' && !Array.isArray(item);

  // Helper: 深層合併物件
  const deepMerge = (target, ...sources) => {
    if (!sources.length) return target;
    const source = sources.shift();

    if (isObject(target) && isObject(source)) {
      for (const key in source) {
        if (isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          deepMerge(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }
    return deepMerge(target, ...sources);
  };

  // 基礎用詞表
  const zhtw = {
    Mission: { Name: {}, Desc: {}, Keywords: {}, Remark: {} },
    Trigger: { Name: {}, Desc: {}, Keywords: {}, Remark: {} },
    Battle: { Name: {}, Desc: {}, Keywords: {}, Remark: {} },
    Combat: { Name: {}, Desc: {}, Keywords: {}, Remark: {} },
    Script: { Name: {}, Desc: {}, Keywords: {}, Remark: {} },
    Position: { Action: {} },
    Free: {},
    GroupStat: {},
    Flag: {},
    Story: {}
  };
  deepMerge(zhtw, term, termCustom);
  Object.assign(zhtw.Free, scriptFree);

  for (const key in option.Story) {
    zhtw.Story[key] = option.Story[key].short;
  }

  for (const key in battleName) {
    zhtw.Battle.Name[key] = battleName[key].name || battleName[key].ori;
    zhtw.Battle.Desc[key] = battleName[key].desc;
    zhtw.Battle.Keywords[key] = battleName[key].keywords;
  }

  for (const key in combatName) {
    zhtw.Combat.Name[key] = combatName[key].name || combatName[key].ori;
    zhtw.Combat.Desc[key] = combatName[key].desc;
    zhtw.Combat.Keywords[key] = combatName[key].keywords;
  }

  for (const key in scriptName) {
    zhtw.Script.Name[key] = scriptName[key].name || scriptName[key].ori;
    zhtw.Script.Desc[key] = scriptName[key].desc;
    zhtw.Script.Keywords[key] = scriptName[key].keywords;
  }

  for (const key in missionName.mission ?? {}) {
    zhtw.Mission.Name[key] = missionName.mission[key].name || missionName.mission[key].ori;
    zhtw.Mission.Desc[key] = missionName.mission[key].desc;
    zhtw.Mission.Keywords[key] = missionName.mission[key].keywords;
  }

  for (const key in missionName.trigger ?? {}) {
    zhtw.Trigger.Name[key] = missionName.trigger[key].name || missionName.trigger[key].ori;
    zhtw.Trigger.Desc[key] = missionName.trigger[key].desc;
    zhtw.Trigger.Keywords[key] = missionName.trigger[key].keywords;
  }

  for (const key in triggerCustom) {
    if (triggerCustom[key]?.remark?.length) {
      zhtw.Trigger.Remark[key] = {};
      triggerCustom[key].remark.forEach((r, i) => (zhtw.Trigger.Remark[key][i] = r));
    }
  }

  for (const key in missionCustom) {
    if (missionCustom[key]?.remark?.length) {
      zhtw.Mission.Remark[key] = {};
      missionCustom[key].remark.forEach((r, i) => (zhtw.Mission.Remark[key][i] = r));
    }
  }

  for (const key in scriptCustom) {
    if (scriptCustom[key]?.remark?.length) {
      zhtw.Script.Remark[key] = {};
      scriptCustom[key].remark.forEach((r, i) => (zhtw.Script.Remark[key][i] = r));
    }
  }

  for (const key in combatCustom) {
    if (combatCustom[key]?.remark?.length) {
      zhtw.Combat.Remark[key] = {};
      combatCustom[key].remark.forEach((r, i) => (zhtw.Combat.Remark[key][i] = r));
    }
  }

  for (const key in position) {
    zhtw.Position.Action[key] = position[key].action;
  }

  for (const key in groupCustom) {
    const id = groupCustom[key].id;
    if (id) {
      zhtw.GroupStat[groupCustom[key].id] = { _: groupCustom[key].text, Desc: groupCustom[key].name };
    }
  }

  // 處理旗標
  for (const key in flagCustom) {
    zhtw.Flag[key] = { _: flagCustom[key].data[0].name || key, Desc: flagCustom[key].data[0].desc };
    flagCustom[key].data.forEach((flagData, index) => {
      zhtw.Flag[key][index] = { _: flagData.name || key, Desc: flagData.desc };
      Object.assign(zhtw.Flag[key][index], flagData.value);
    });
  }

  // helper: 巢狀處理用詞
  const buildNestedI18n = (data, prefix) => {
    if (typeof data === 'string') {
      // 字串
      return { indexNode: prefix, dictNode: data };
    } else if (Array.isArray(data)) {
      // 陣列
      const indexNode = [];
      const dictNode = {};
      data.forEach((item, index) => {
        const res = buildNestedI18n(item, `${prefix}.${index}`);
        indexNode.push(res.indexNode);
        dictNode[index.toString()] = res.dictNode;
      });
      return { indexNode, dictNode };
    } else if (typeof data === 'object' && data !== null) {
      // 物件
      const indexNode = {};
      const dictNode = {};
      for (const key in data) {
        const res = buildNestedI18n(data[key], `${prefix}.${key}`);
        indexNode[key] = res.indexNode;
        dictNode[key] = res.dictNode;
      }
      return { indexNode, dictNode };
    }

    // 其他型別
    return { indexNode: data, dictNode: data };
  };

  // 網站資訊
  const { indexNode: aboutIndex, dictNode: aboutDict } = buildNestedI18n(about, 'About');
  zhtw.About = aboutDict;
  await exportJson(aboutIndex, 'about', 'public/web', true);

  // 讀取其他語系
  const [zhcnTerm, krTerm, jpTerm, krXlat, jpXlat] = await Promise.all([
    getGameJson('zh-cn', '../Localizations'),
    getGameJson('kr', '../Localizations'),
    getGameJson('jp', '../Localizations'),
    getDataJson('kr'),
    getDataJson('jp')
  ]);

  const regexParamN = /{(\d+):N0}/g;
  const regexParamP = /{(\d+):P0}/g;
  const zhcn = {};
  const kr = {};
  const jp = {};

  // Helper: 處理{0:N0}參數
  const replaceParam = (prefix, text) => {
    if (prefix !== 'UpgradeItemRelationDesc/') return text;
    return text.replace(regexParamN, '{$1}').replace(regexParamP, '{$1}%');
  };

  // Helper: 深層替換物件
  const deepReplace = async (targetZhcn, targetKr, targetJp, targetKrXlat, targetJpXlat, source, prefix) => {
    if (isObject(source)) {
      for (const key in source) {
        if (isObject(source[key])) {
          if (!targetZhcn[key]) Object.assign(targetZhcn, { [key]: {} });
          if (!targetKr[key]) Object.assign(targetKr, { [key]: {} });
          if (!targetKrXlat[key]) Object.assign(targetKrXlat, { [key]: {} });
          if (!targetJp[key]) Object.assign(targetJp, { [key]: {} });
          if (!targetJpXlat[key]) Object.assign(targetJpXlat, { [key]: {} });
          await deepReplace(targetZhcn[key], targetKr[key], targetJp[key], targetKrXlat[key], targetJpXlat[key], source[key], `${prefix}${key}/`);
        } else {
          const hasChinese = regexHan.test(source[key]);
          const path = `${prefix}${key}`.replace(regexEnd, '');
          const label = key === '_' ? prefix.replace(regexEnd0, '') : key;
          Object.assign(targetZhcn, { [key]: hasChinese ? (replaceParam(prefix, zhcnTerm[path]) ?? converter(source[key])) : source[key] });
          Object.assign(targetKr, { [key]: hasChinese ? (replaceParam(prefix, krTerm[path]) ?? targetKrXlat[key]) || label : source[key] });
          Object.assign(targetKrXlat, { [key]: hasChinese ? (replaceParam(prefix, krTerm[path]) ?? targetKrXlat[key] ?? '') : source[key] });
          Object.assign(targetJp, { [key]: hasChinese ? (replaceParam(prefix, jpTerm[path]) ?? targetJpXlat[key]) || label : source[key] });
          Object.assign(targetJpXlat, { [key]: hasChinese ? (replaceParam(prefix, jpTerm[path]) ?? targetJpXlat[key] ?? '') : source[key] });
        }
      }
    }
  };
  await deepReplace(zhcn, kr, jp, krXlat, jpXlat, zhtw, '');

  // 並行輸出結果
  await Promise.all([
    exportJson(zhtw, 'zh-tw', 'public/locales', true),
    exportJson(zhcn, 'zh-cn', 'public/locales', true),
    exportJson(kr, 'kr', 'public/locales', true),
    exportJson(jp, 'jp', 'public/locales', true),
    exportJson(krXlat, 'kr'),
    exportJson(jpXlat, 'jp')
  ]);

  // 額外生成完整版本
  for (const key in option.Story) {
    zhtw.Story[key] = option.Story[key];
  }
  deepMerge(zhtw, dialog);
  await exportJson(zhtw, 'zh-tw', 'public/full/locales', true);
}

export async function parser(method) {
  switch (method.toLowerCase()) {
    case 'test':
      await parseBattleSkill();
      break;
    case 'all':
      await loadCache(['MISC', 'SPECIAL', 'TALENT', 'SKILL', 'FLAG', 'TERM', 'BOOK', 'EQUIP', 'GROUP', 'MISSION', 'POSITION', 'CONDITION', 'SWITCH', 'DICE', 'COMBAT', 'BATTLE', 'SCRIPT'], true);
      await organizeOutputData();
      await parseLocalization();
      break;
    case 'locale':
      await parseLocalization();
      break;
    case 'switch':
      await parseSwitch();
      break;
    case 'dice':
      await parseDice();
      break;
    case 'condition':
      await parseCondition();
      break;
    case 'position':
      await parsePosition();
      break;
    case 'mission':
      await parseMission();
      break;
    case 'flag':
      await parseFlag();
      break;
    case 'term':
      await parseTerm();
      break;
    case 'combat':
      await parseCombat();
      break;
    case 'battle':
      await parseBattle();
      break;
    case 'script':
      await parseScript();
      break;
    default:
      process.exit(1);
  }
}
