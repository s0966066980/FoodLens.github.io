/**
 * FoodLens - 食物熱量辨識器
 * 使用 Google Gemini API 分析食物圖片並估算熱量
 */

// ========== 常數 ==========
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const STORAGE_KEY_API = 'foodlens_api_key';
const STORAGE_KEY_MODEL = 'foodlens_model';
const STORAGE_KEY_HISTORY = 'foodlens_history';
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash-lite'];

function getGeminiUrl(model) {
    return `${GEMINI_API_BASE}/${model}:generateContent`;
}

function getModel() {
    return localStorage.getItem(STORAGE_KEY_MODEL) || DEFAULT_MODEL;
}

function setModel(model) {
    localStorage.setItem(STORAGE_KEY_MODEL, model);
}

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
    modelSelect: $('#model-select'),

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

function showErrorModal(title, message, details) {
    const existing = document.querySelector('.error-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'error-overlay modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>❌ ${title}</h2>
                <button class="modal-close" onclick="this.closest('.error-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <p style="color:var(--text-primary);line-height:1.6;">${message}</p>
                ${details ? `<details style="margin-top:12px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:0.8rem;">詳細錯誤訊息</summary><pre style="margin-top:8px;padding:12px;background:var(--surface);border-radius:8px;font-size:0.75rem;color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;max-height:150px;overflow-y:auto;">${details}</pre></details>` : ''}
            </div>
        </div>
    `;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
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

// 壓縮圖片到適當大小（降低 API token 消耗）
function compressImage(imgEl, mimeType, maxDim = 800) {
    return new Promise((resolve) => {
        const onLoad = () => {
            const canvas = document.createElement('canvas');
            let w = imgEl.naturalWidth;
            let h = imgEl.naturalHeight;
            if (w > maxDim || h > maxDim) {
                const ratio = Math.min(maxDim / w, maxDim / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgEl, 0, 0, w, h);
            const dataUrl = canvas.toDataURL(mimeType === 'image/png' ? 'image/png' : 'image/jpeg', 0.8);
            resolve(dataUrl.split(',')[1]);
        };
        if (imgEl.complete && imgEl.naturalWidth) {
            onLoad();
        } else {
            imgEl.addEventListener('load', onLoad, { once: true });
        }
    });
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
    if (dom.modelSelect) dom.modelSelect.value = getModel();
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
    if (dom.modelSelect) setModel(dom.modelSelect.value);
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

    // 壓縮圖片再轉 base64（降低 token 消耗）
    compressImage(dom.previewImage, file.type).then((b64) => {
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
        const requestBody = JSON.stringify({
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
        });

        // 嘗試使用者選的模型，失敗則自動 fallback
        const selectedModel = getModel();
        const modelsToTry = [selectedModel, ...FALLBACK_MODELS.filter(m => m !== selectedModel)];
        let response = null;
        let lastError = null;

        for (const model of modelsToTry) {
            try {
                response = await fetch(`${getGeminiUrl(model)}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: requestBody,
                });

                if (response.ok) {
                    if (model !== selectedModel) {
                        showToast(`已自動切換至 ${model}`, 'info');
                    }
                    break;
                }

                const errData = await response.json().catch(() => ({}));
                const errMsg = errData?.error?.message || '';
                lastError = errMsg || `API 錯誤 (${response.status})`;

                // 400 = key 無效，不用再試其他模型
                if (response.status === 400) {
                    throw { type: 'INVALID_KEY', message: errMsg };
                }

                // 403 = API 未啟用或權限問題
                if (response.status === 403) {
                    throw { type: 'FORBIDDEN', message: errMsg };
                }

                // 429 或 503 = 額度/服務問題，試下一個模型
                if (response.status === 429 || response.status === 503) {
                    // 偵測 limit: 0 的情況
                    if (errMsg.includes('limit: 0')) {
                        lastError = '__ZERO_QUOTA__:' + errMsg;
                    }
                    console.warn(`${model} 回傳 ${response.status}，嘗試下一個模型...`);
                    response = null;
                    continue;
                }

                // 其他錯誤直接丟出
                throw { type: 'OTHER', message: lastError };
            } catch (fetchErr) {
                if (fetchErr.type === 'INVALID_KEY' || fetchErr.type === 'FORBIDDEN' || fetchErr.type === 'OTHER') throw fetchErr;
                lastError = fetchErr.message || String(fetchErr);
                response = null;
            }
        }

        if (!response || !response.ok) {
            // 判斷是 limit:0 還是普通額度用完
            if (lastError && lastError.startsWith('__ZERO_QUOTA__:')) {
                throw { type: 'ZERO_QUOTA', message: lastError.replace('__ZERO_QUOTA__:', '') };
            }
            throw { type: 'QUOTA_EXCEEDED', message: lastError || '所有模型均無法使用' };
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

        if (err?.type === 'ZERO_QUOTA') {
            showErrorModal(
                '免費額度為 0',
                `你的 API Key 的免費額度限制為 0，這通常代表：<br><br>
                <b>1.</b> API Key 需從 <a href="https://aistudio.google.com/apikey" target="_blank" style="color:var(--accent);">AI Studio</a> 產生（不是 Google Cloud Console）<br>
                <b>2.</b> 或需要在 <a href="https://console.cloud.google.com/billing" target="_blank" style="color:var(--accent);">Google Cloud</a> 啟用帳單（免費額度內不收費）<br>
                <b>3.</b> 或你所在地區不支援免費層級<br><br>
                <b>建議：</b>前往 AI Studio 重新產生一組新的 API Key 試試。`,
                err.message
            );
        } else if (err?.type === 'QUOTA_EXCEEDED') {
            showErrorModal(
                'API 額度已耗盡',
                `所有模型的免費額度均已用完，請等待額度重置（通常為每分鐘或每日重置）。<br><br>
                <b>提示：</b>切換到 Gemini 2.0 Flash Lite 模型可獲得最大免費額度（每日 1500 次）。`,
                err.message
            );
        } else if (err?.type === 'INVALID_KEY') {
            showErrorModal('API Key 無效', '請確認你的 API Key 是否正確。前往設定重新輸入。', err.message);
        } else if (err?.type === 'FORBIDDEN') {
            showErrorModal('權限不足', '你的 API Key 沒有使用 Gemini API 的權限。請確認 Generative Language API 已啟用。', err.message);
        } else if (err instanceof SyntaxError) {
            showToast('AI 回覆格式異常，請重試');
        } else {
            showToast(err?.message || err?.toString() || '分析失敗，請重試');
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
