import { parser } from './parser.js'

const args = process.argv.slice(2)
if (args.length < 1) {
    console.error('\x1b[31mPlease provide parse type.\x1b[0m');
    process.exit(1);
}
await parser(...args);