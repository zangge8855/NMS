import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDataDir = path.resolve(__dirname, '../../data');

const KEEP_FILES = new Set(['.gitkeep']);

export function cleanData(targetDir = rootDataDir) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        return { deleted: [] };
    }

    const deleted = [];
    const files = fs.readdirSync(targetDir);
    for (const file of files) {
        if (KEEP_FILES.has(file)) continue;
        const filePath = path.join(targetDir, file);
        try {
            fs.rmSync(filePath, { recursive: true, force: true });
            deleted.push(file);
        } catch (err) {
            console.error(`Failed to delete ${file}:`, err.message);
        }
    }

    // Ensure .gitkeep exists
    const gitkeepPath = path.join(targetDir, '.gitkeep');
    if (!fs.existsSync(gitkeepPath)) {
        fs.writeFileSync(gitkeepPath, '', 'utf8');
    }

    return { deleted };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = cleanData();
    console.log('✅ Cleaned test data in /data directory. Ready for GitHub push:');
    console.log('   Removed files:', result.deleted.join(', ') || '(already clean)');
}
