/**
 * FoodLens - 食物熱量辨識器
 * 使用 Google Gemini API 分析食物圖片並估算熱量
 */

// ========== 常數 ==========
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const STORAGE_KEY_API = 'foodlens_api_key';
const STORAGE_KEY_HISTORY = 'foodlens_history';

const SYSTEM_PROMPT = `你是一個專業的營養師 AI，請分析使用者上傳的食物圖片。

請嚴格按照以下 JSON 格式回覆，不要加任何其他文字或 markdown 標記：

{
  "name": "食物名稱（繁體中文）",
  "calories": 數字（總熱量 kcal，整數）,
  "protein": 數字（蛋白質 g，保留一位小數）,
  "carbs": 數字（碳水化合物 g，保留一位小數）,
  "fat": 數字（脂肪 g，保留一位小數）,
  "fiber": 數字（膳食纖維 g，保留一位小數）,
  "portion": "估算份量描述",
  "description": "簡短描述（20字以內）",
  "note": "營養建議或備註（30字以內，可選）"
}

規則：
1. 如果圖片中有多種食物，列出主要的整體餐點名稱，並計算所有食物的總熱量
2. 如果無法辨識，name 設為 "無法辨識"，其餘數值設為 0
3. 所有文字使用繁體中文
4. 數值請基於常見份量進行估算
5. 只回覆 JSON，不要有任何其他文字`;

// ========== DOM 元素 ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    settingsModal: $('#settings-modal'),
    openSettings: $('#open-settings'),
    closeSettings: $('#close-settings'),
    apiKeyInput: $('#api-key-input'),
    toggleKeyVis: $('#toggle-key-visibility'),
    saveApiKey: $('#save-api-key'),

    dropZone: $('#drop-zone'),
    dropZoneContent: $('#drop-zone-content'),
    previewContainer: $('#preview-container'),
    previewImage: $('#preview-image'),
    removeImage: $('#remove-image'),
    fileInput: $('#file-input'),
    cameraInput: $('#camera-input'),
    cameraBtn: $('#camera-btn'),
    analyzeBtn: $('#analyze-btn'),

    resultSection: $('#result-section'),
    foodName: $('#food-name'),
    foodCalories: $('#food-calories'),
    foodDescription: $('#food-description'),
    macroProtein: $('#macro-protein'),
    macroCarbs: $('#macro-carbs'),
    macroFat: $('#macro-fat'),
    macroFiber: $('#macro-fiber'),
    barProtein: $('#bar-protein'),
    barCarbs: $('#bar-carbs'),
    barFat: $('#bar-fat'),
    barFiber: $('#bar-fiber'),
    portionInfo: $('#portion-info'),
    foodNote: $('#food-note'),

    historyList: $('#history-list'),
    todayTotal: $('#today-total'),
    clearHistory: $('#clear-history'),
};

// ========== 狀態 ==========
let currentImageBase64 = null;
let currentImageMime = null;
let isAnalyzing = false;

// ========== 工具函式 ==========
function showToast(msg, type = 'error') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function getApiKey() {
    return localStorage.getItem(STORAGE_KEY_API) || '';
}

function setApiKey(key) {
    localStorage.setItem(STORAGE_KEY_API, key.trim());
}

function getHistory() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function setHistory(data) {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(data));
}

function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ========== 設定 Modal ==========
function openSettingsModal() {
    dom.apiKeyInput.value = getApiKey();
    dom.settingsModal.style.display = 'flex';
    dom.apiKeyInput.focus();
}

function closeSettingsModal() {
    dom.settingsModal.style.display = 'none';
}

dom.openSettings.addEventListener('click', openSettingsModal);
dom.closeSettings.addEventListener('click', closeSettingsModal);

dom.settingsModal.addEventListener('click', (e) => {
    if (e.target === dom.settingsModal) closeSettingsModal();
});

dom.toggleKeyVis.addEventListener('click', () => {
    const isPassword = dom.apiKeyInput.type === 'password';
    dom.apiKeyInput.type = isPassword ? 'text' : 'password';
    dom.toggleKeyVis.textContent = isPassword ? '🙈' : '👁️';
});

dom.saveApiKey.addEventListener('click', () => {
    const key = dom.apiKeyInput.value.trim();
    if (!key) {
        showToast('請輸入 API Key');
        return;
    }
    setApiKey(key);
    closeSettingsModal();
    showToast('API Key 已儲存 ✅', 'success');
});

// 首次使用，自動彈出設定
if (!getApiKey()) {
    setTimeout(openSettingsModal, 500);
}

// ========== 圖片上傳 ==========
function handleFile(file) {
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        showToast('不支援的格式，請使用 JPG/PNG/WebP');
        return;
    }

    if (file.size > 20 * 1024 * 1024) {
        showToast('檔案過大，請小於 20MB');
        return;
    }

    currentImageMime = file.type;

    // 顯示預覽
    const url = URL.createObjectURL(file);
    dom.previewImage.src = url;
    dom.previewContainer.style.display = 'block';
    dom.dropZoneContent.style.display = 'none';
    dom.analyzeBtn.disabled = false;

    // 轉 base64
    fileToBase64(file).then((b64) => {
        currentImageBase64 = b64;
    });
}

function clearImage() {
    currentImageBase64 = null;
    currentImageMime = null;
    dom.previewContainer.style.display = 'none';
    dom.dropZoneContent.style.display = 'flex';
    dom.analyzeBtn.disabled = true;
    dom.fileInput.value = '';
    dom.cameraInput.value = '';
    if (dom.previewImage.src.startsWith('blob:')) {
        URL.revokeObjectURL(dom.previewImage.src);
    }
}

dom.fileInput.addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
});

dom.cameraInput.addEventListener('change', (e) => {
    handleFile(e.target.files[0]);
});

dom.cameraBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dom.cameraInput.click();
});

dom.removeImage.addEventListener('click', (e) => {
    e.stopPropagation();
    clearImage();
});

// Drop zone click → 選擇檔案
dom.dropZone.addEventListener('click', (e) => {
    if (e.target.closest('.btn-upload') || e.target.closest('.btn-camera') || e.target.closest('.remove-btn')) return;
    if (dom.previewContainer.style.display !== 'none') return;
    dom.fileInput.click();
});

// Drag & Drop
dom.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.dropZone.classList.add('drag-over');
});

dom.dropZone.addEventListener('dragleave', () => {
    dom.dropZone.classList.remove('drag-over');
});

dom.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    handleFile(file);
});

// ========== Gemini API 呼叫 ==========
async function analyzeImage() {
    if (isAnalyzing || !currentImageBase64) return;

    const apiKey = getApiKey();
    if (!apiKey) {
        showToast('請先設定 API Key');
        openSettingsModal();
        return;
    }

    isAnalyzing = true;
    dom.analyzeBtn.querySelector('.btn-text').style.display = 'none';
    dom.analyzeBtn.querySelector('.btn-loading').style.display = 'inline-flex';
    dom.analyzeBtn.disabled = true;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: SYSTEM_PROMPT },
                            {
                                inline_data: {
                                    mime_type: currentImageMime,
                                    data: currentImageBase64,
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    temperature: 0.3,
                    topP: 0.8,
                    maxOutputTokens: 1024,
                },
            }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            if (response.status === 400) {
                throw new Error('API Key 無效或請求格式錯誤');
            } else if (response.status === 429) {
                throw new Error('API 呼叫次數超過限制，請稍後再試');
            } else {
                throw new Error(errData?.error?.message || `API 錯誤 (${response.status})`);
            }
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            throw new Error('未收到有效回覆');
        }

        // 解析 JSON（處理可能的 markdown code block 包裹）
        let cleaned = text.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }

        const result = JSON.parse(cleaned);
        showResult(result);
        addToHistory(result);
    } catch (err) {
        console.error('分析失敗:', err);
        if (err instanceof SyntaxError) {
            showToast('AI 回覆格式異常，請重試');
        } else {
            showToast(err.message || '分析失敗，請重試');
        }
    } finally {
        isAnalyzing = false;
        dom.analyzeBtn.querySelector('.btn-text').style.display = 'inline';
        dom.analyzeBtn.querySelector('.btn-loading').style.display = 'none';
        dom.analyzeBtn.disabled = false;
    }
}

dom.analyzeBtn.addEventListener('click', analyzeImage);

// ========== 顯示結果 ==========
function showResult(result) {
    dom.foodName.textContent = result.name || '未知食物';
    dom.foodCalories.textContent = `${result.calories || 0} kcal`;
    dom.foodDescription.textContent = result.description || '';

    dom.macroProtein.textContent = `${result.protein || 0}g`;
    dom.macroCarbs.textContent = `${result.carbs || 0}g`;
    dom.macroFat.textContent = `${result.fat || 0}g`;
    dom.macroFiber.textContent = `${result.fiber || 0}g`;

    dom.portionInfo.textContent = result.portion ? `📏 ${result.portion}` : '';
    dom.foodNote.textContent = result.note || '';

    // 計算營養素比例（用百分比填充）
    const total = (result.protein || 0) + (result.carbs || 0) + (result.fat || 0) + (result.fiber || 0);
    if (total > 0) {
        setTimeout(() => {
            dom.barProtein.style.width = `${((result.protein || 0) / total) * 100}%`;
            dom.barCarbs.style.width = `${((result.carbs || 0) / total) * 100}%`;
            dom.barFat.style.width = `${((result.fat || 0) / total) * 100}%`;
            dom.barFiber.style.width = `${((result.fiber || 0) / total) * 100}%`;
        }, 100);
    }

    dom.resultSection.style.display = 'block';

    // 捲動到結果
    dom.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ========== 歷史紀錄 ==========
function addToHistory(result) {
    const history = getHistory();
    const today = getTodayKey();

    const entry = {
        id: Date.now(),
        date: today,
        time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }),
        name: result.name,
        calories: result.calories || 0,
        protein: result.protein || 0,
        carbs: result.carbs || 0,
        fat: result.fat || 0,
        // 儲存縮圖（壓縮版的 base64）
        thumb: createThumbnail(),
    };

    history.unshift(entry);

    // 只保留最近 50 筆
    if (history.length > 50) history.length = 50;

    setHistory(history);
    renderHistory();
}

function createThumbnail() {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 80;
        canvas.height = 80;
        ctx.drawImage(dom.previewImage, 0, 0, 80, 80);
        return canvas.toDataURL('image/jpeg', 0.5);
    } catch {
        return '';
    }
}

function renderHistory() {
    const history = getHistory();
    const today = getTodayKey();
    const todayItems = history.filter((h) => h.date === today);

    // 計算今日總熱量
    const totalCal = todayItems.reduce((sum, h) => sum + (h.calories || 0), 0);
    dom.todayTotal.textContent = `${totalCal} kcal`;

    if (todayItems.length === 0) {
        dom.historyList.innerHTML = '<p class="empty-state">尚未有任何紀錄，拍張照片開始吧！</p>';
        return;
    }

    dom.historyList.innerHTML = todayItems
        .map(
            (item) => `
        <div class="history-item" data-id="${item.id}">
            ${item.thumb ? `<img class="history-thumb" src="${item.thumb}" alt="${item.name}">` : '<div class="history-thumb" style="background:var(--surface);display:flex;align-items:center;justify-content:center;">🍽️</div>'}
            <div class="history-info">
                <div class="history-name">${item.name}</div>
                <div class="history-meta">${item.time} · P${item.protein}g C${item.carbs}g F${item.fat}g</div>
            </div>
            <span class="history-kcal">${item.calories} kcal</span>
            <button class="history-delete" onclick="deleteHistoryItem(${item.id})" title="刪除">✕</button>
        </div>
    `
        )
        .join('');
}

function deleteHistoryItem(id) {
    let history = getHistory();
    history = history.filter((h) => h.id !== id);
    setHistory(history);
    renderHistory();
    showToast('已刪除', 'info');
}

// 全域暴露
window.deleteHistoryItem = deleteHistoryItem;

dom.clearHistory.addEventListener('click', () => {
    if (!confirm('確定要清除所有紀錄嗎？')) return;
    setHistory([]);
    renderHistory();
    showToast('已清除所有紀錄', 'info');
});

// ========== 初始化 ==========
renderHistory();
