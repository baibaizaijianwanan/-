const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// 激活码存储文件
const CODES_FILE = path.join(__dirname, 'codes.json');

// 加载激活码
function loadCodes() {
    if (!fs.existsSync(CODES_FILE)) {
        fs.writeFileSync(CODES_FILE, JSON.stringify({}), 'utf8');
        return {};
    }
    return JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
}

// 保存激活码
function saveCodes(codes) {
    fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2), 'utf8');
}

// 当前激活码数据（内存缓存）
let codes = loadCodes();

// 激活码格式
const CODE_REGEX = /^MEMBER-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// 生成UUID（简单版）
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ============ 核心算法（从原HTML迁移） ============
// 保持原有函数逻辑完全一致，以下仅列出关键部分

function generateBasicRow(rngFunc, basicItems) { /* ... 原代码 ... */ }

function generateLatentScores(N, seedVal, basicRows, dimensions, regressionEdges, moderationEffects, diffRules) { /* ... */ }

function applyDiffRules(scores, basicRows, dimIdToIdx, diffRules) { /* ... */ }

function generateRawItemScores(latentScores, N, dimList, assignments) { /* ... */ }

function adjustAndDiscretize(rawScores, targetMeans, targetSDs) { /* ... */ }

// 主生成函数
function generateData(params) {
    const { sampleSize, totalItems, randomSeed, basicItems, dimensions, itemAssignments, itemTargetMean, itemTargetSD, regressionEdges, moderationEffects, diffRules } = params;

    // 复制逻辑与前端完全一致
    let seedVal = randomSeed || Math.floor(Math.random() * 100000);
    const rng = (() => { let s = seedVal; return () => { const x = Math.sin(s++) * 10000; return x - Math.floor(x); }; })();

    const basicRows = Array(sampleSize).fill().map(() => generateBasicRow(rng, basicItems));
    const latent = generateLatentScores(sampleSize, seedVal + 1000, basicRows, dimensions, regressionEdges, moderationEffects, diffRules);
    const rawItems = generateRawItemScores(latent, sampleSize, dimensions, itemAssignments);
    const final = adjustAndDiscretize(rawItems, itemTargetMean, itemTargetSD);

    const dimNames = dimensions.map(d => d.name);
    const headers = [...basicItems.map(b => b.name), ...Array(totalItems).fill().map((_, i) => `Q${i+1}_${dimNames[dimensions.findIndex(d=>d.id===itemAssignments[i])]||'unknown'}`)];
    const rows = [];

    for (let i = 0; i < sampleSize; i++) {
        const row = { ...basicRows[i] };
        for (let j = 0; j < totalItems; j++) {
            row[headers[basicItems.length + j]] = final[i][j];
        }
        rows.push(row);
    }
    return { headers, rows };
}

// 生成CSV字符串
function convertToCSV(headers, rows) {
    let csv = headers.map(h => `"${h}"`).join(',') + '\n';
    for (const row of rows) {
        csv += headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(',') + '\n';
    }
    return '\uFEFF' + csv; // BOM for Excel
}

// ============ API 路由 ============

// 激活码校验
app.post('/api/validate-code', (req, res) => {
    const { code } = req.body;
    const trimmed = (code || '').trim().toUpperCase();
    if (!CODE_REGEX.test(trimmed)) {
        return res.json({ valid: false, message: '格式错误' });
    }

    const codeData = codes[trimmed];
    if (!codeData) {
        return res.json({ valid: false, message: '激活码无效' });
    }

    if (codeData.remaining <= 0 && !codeData.userId) {
        return res.json({ valid: false, message: '次数已用完' });
    }

    return res.json({ valid: true });
});

// 绑定用户并激活
app.post('/api/activate', (req, res) => {
    const { code, userId } = req.body;
    const trimmed = (code || '').trim().toUpperCase();
    if (!CODE_REGEX.test(trimmed) || !userId) {
        return res.json({ success: false, message: '参数错误' });
    }

    const codeData = codes[trimmed];
    if (!codeData) return res.json({ success: false, message: '激活码无效' });

    // 如果已绑定其他用户，不允许
    if (codeData.userId && codeData.userId !== userId) {
        return res.json({ success: false, message: '该激活码已被其他用户使用' });
    }

    // 首次绑定
    if (!codeData.userId) {
        codeData.userId = userId;
        codeData.remaining = 20; // 新激活码初始次数
        saveCodes(codes);
    }

    return res.json({ success: true, remaining: codeData.remaining, message: '激活成功' });
});

// 生成数据（需激活码）
app.post('/api/generate', (req, res) => {
    const { code, userId, ...params } = req.body;
    const trimmed = (code || '').trim().toUpperCase();

    if (!CODE_REGEX.test(trimmed) || !userId) {
        return res.status(403).json({ error: '未提供有效激活码' });
    }

    const codeData = codes[trimmed];
    if (!codeData || codeData.userId !== userId) {
        return res.status(403).json({ error: '激活码无效或未绑定' });
    }
    if (codeData.remaining <= 0) {
        return res.status(403).json({ error: '生成次数已用完' });
    }

    // 检查参数有效性
    if (!params.sampleSize || !params.totalItems) {
        return res.status(400).json({ error: '参数缺失' });
    }

    try {
        const data = generateData(params);
        // 扣减次数
        codeData.remaining--;
        saveCodes(codes);

        // 返回CSV文件
        const csvContent = convertToCSV(data.headers, data.rows);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="questionnaire_${Date.now()}.csv"`);
        res.send(csvContent);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: '生成失败' });
    }
});

// 获取会员状态
app.post('/api/status', (req, res) => {
    const { code, userId } = req.body;
    const trimmed = (code || '').trim().toUpperCase();
    if (!CODE_REGEX.test(trimmed) || !userId) {
        return res.json({ isMember: false, remaining: 0 });
    }
    const codeData = codes[trimmed];
    if (codeData && codeData.userId === userId) {
        return res.json({ isMember: true, remaining: codeData.remaining });
    }
    return res.json({ isMember: false, remaining: 0 });
});

// 生成新激活码（仅供管理员使用，可加口令保护）
app.post('/admin/generate-codes', (req, res) => {
    const { count = 1, adminKey } = req.body;
    const ADMIN_SECRET = 'your-admin-secret-123'; // 请修改
    if (adminKey !== ADMIN_SECRET) return res.status(403).json({ error: '无权限' });

    const newCodes = [];
    for (let i = 0; i < count; i++) {
        let code;
        do {
            code = 'MEMBER-' + Array.from({ length: 12 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('').replace(/(.{4})/g, '$1-').slice(0, -1);
        } while (codes[code]);
        codes[code] = { remaining: 20, userId: null };
        newCodes.push(code);
    }
    saveCodes(codes);
    res.json({ codes: newCodes });
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
