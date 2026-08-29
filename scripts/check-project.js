const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Handlebars = require('handlebars');

const root = path.resolve(__dirname, '..');

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(filePath) : [filePath];
    });
}

const javascriptFiles = walk(path.join(root, 'src')).filter((file) =>
    file.endsWith('.js'),
);
const templateFiles = walk(path.join(root, 'src', 'resources', 'views')).filter(
    (file) => file.endsWith('.hbs'),
);

for (const file of javascriptFiles) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

for (const file of templateFiles) {
    Handlebars.precompile(fs.readFileSync(file, 'utf8'));
}

console.log(
    `Đã kiểm tra ${javascriptFiles.length} tệp JavaScript và ${templateFiles.length} template.`,
);
