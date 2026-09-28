/**
 * SANLY TEBIP AI - JavaScript Controller (ID Mismatch Fixed)
 */
//  const BASE_URL = "https://sanly-tebip-ai-2.onrender.com";
const BASE_URL = "http://localhost:5000";

// --- 1. ELEMENT SEÇİCİLERİ (HTML-e laýyklandy) ---
const startRecordBtn = document.getElementById('mic-btn'); 
const recordingStatus = document.getElementById('mic-status'); 
const chatWindow = document.getElementById('chat-window');
const userMsgInput = document.getElementById('user-msg');
const sendBtn = document.getElementById('send-btn');
const historyList = document.getElementById('history-list');
const plantTitle = document.getElementById('plant-title'); 
const plantDescription = document.getElementById('plant-description'); 
const imageDisplay = document.getElementById('image-display'); 
const aiSuggestions = document.getElementById('ai-suggestions'); 
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

// --- 2. ÝAT (MEMORY) WE GLOBAL ÜÝTGEYJILER ---
let allChats = JSON.parse(localStorage.getItem('sanlyTebip_allMessages')) || {};
let chatHistory = JSON.parse(localStorage.getItem('sanlyTebip_historyList')) || [];
let currentChatId = null; 

// Sahypa ýüklenende taryhy we ýatda saklanan çaty dikeltmek
document.addEventListener('DOMContentLoaded', () => {
    renderHistory();
    
    const lastChatId = localStorage.getItem('sanlyTebip_currentChatId');
    if (lastChatId && allChats[lastChatId]) {
        loadChat(lastChatId);
    } else if (chatHistory.length > 0) {
        loadChat(chatHistory[0].id);
    } else {
        startNewChat();
    }
});

// --- 3. ESASY AI FUNKSIÝALARY ---

function startNewChat() {
    chatWindow.innerHTML = `
        <div class="flex items-start gap-6 max-w-4xl mx-auto message-appear">
            <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex-shrink-0 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.25)] text-2xl text-white">👨‍⚕️</div>
            <div class="space-y-3 pt-1 text-left">
                <div class="bg-white/[0.03] backdrop-blur-3xl p-7 rounded-[2.2rem] rounded-tl-none border border-white/10 leading-relaxed text-slate-100 shadow-2xl text-[17px]">
                Salam! Men Sanly-Tebip atly ilkinji emeli aň ulgamy. Men diňe Gahryman Arkadagymyzyň «Türkmenistanyň dermanlyk ösümlikleri» atly ylmy ensiklopediýasynyň dermanlyk ösümlikleriniň şypaly syrlary we ynsan saglygy barada size maslahat bermek üçin döredilen emeli aň ulgamydyryn. Size nähili kömek edip bilerin?
                </div>
            </div>
        </div>
    `;
    currentChatId = null;
    resetRightPanel();
}

async function sendToAI() {
    const prompt = userMsgInput.value.trim();
    console.log("Inputdan alnan bahasy:", prompt); // Barlamak üçin
    if (!prompt) {
        alert("Maglumat boş bolup bilmez!");
        return;
    }

    checkOrCreateChat(prompt);

    renderMessageUI(prompt, 'user');
    saveToMemory(currentChatId, prompt, 'user');
    userMsgInput.value = '';

    const loading = showLoading();

    try {
        const response = await fetch(`${BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        const data = await response.json();
        
        loading.remove();
        renderTypewriter(data.text);
        saveToMemory(currentChatId, data.text, 'bot');

        if (data.plants && data.plants.length > 0) {
            updateRightPanel(data);
        }
    } catch (err) {
        if (loading) loading.remove();
        renderMessageUI("Bagyşlaň, baglanyşykda ýalňyşlyk ýüze çykdy.", 'bot');
    }
}

function checkOrCreateChat(titleText) {
    if (!currentChatId) {
        currentChatId = 'chat_' + Date.now();
        allChats[currentChatId] = [];
        
        const newChat = {
            id: currentChatId,
            title: titleText.length > 25 ? titleText.substring(0, 25) + '...' : titleText,
            date: new Date().toLocaleDateString()
        };
        chatHistory.unshift(newChat);
        saveToLocalStorage();
    }
}

// --- 4. ÝAT WE LOCAL STORAGE FUNKSIÝALARY ---

function saveToMemory(chatId, text, type) {
    if (!allChats[chatId]) allChats[chatId] = [];
    allChats[chatId].push({ text, type });
    saveToLocalStorage();
}

function saveToLocalStorage() {
    localStorage.setItem('sanlyTebip_allMessages', JSON.stringify(allChats));
    localStorage.setItem('sanlyTebip_historyList', JSON.stringify(chatHistory));
    localStorage.setItem('sanlyTebip_currentChatId', currentChatId); 
    renderHistory();
}

function deleteChat(id, event) {
    event.stopPropagation();
    if(confirm("Bu söhbetdeşligi pozmalymy?")) {
        delete allChats[id]; 
        chatHistory = chatHistory.filter(chat => chat.id !== id); 
        if (currentChatId === id) startNewChat();
        saveToLocalStorage();
    }
}

function renderHistory() {
    if (!historyList) return;
    historyList.innerHTML = '';

    chatHistory.forEach(chat => {
        const isActive = currentChatId === chat.id;
        const item = document.createElement('div');
        
        item.className = `history-item group/item flex items-center justify-center group-[.sidebar-open]:justify-between p-3 mb-2 rounded-[1.2rem] cursor-pointer transition-all border border-transparent min-h-[52px] ${isActive ? 'bg-emerald-500/10 border-emerald-500/20' : 'hover:bg-white/[0.05]'}`;
        
        item.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden w-full" onclick="loadChat('${chat.id}')">
                <div class="flex-shrink-0 flex items-center justify-center w-6 h-6 ${isActive ? 'text-emerald-500' : 'text-slate-500'}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <div class="flex-col leading-tight overflow-hidden hidden group-[.sidebar-open]:flex">
                    <span class="truncate text-sm font-semibold ${isActive ? 'text-emerald-400' : 'text-slate-300'} group-hover/item:text-white transition-colors">
                        ${chat.title}
                    </span>
                    <span class="text-[11px] text-slate-500 font-medium">
                        ${chat.date || 'Şu gün'}
                    </span>
                </div>
            </div>
            
            <button onclick="deleteChat('${chat.id}', event)" 
                    class="delete-btn hidden group-[.sidebar-open]:flex opacity-0 group-hover/item:opacity-100 p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all duration-200 flex-shrink-0" 
                    title="Poz">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;
        
        historyList.appendChild(item);
    });
}

function loadChat(chatId) {
    if (!chatId || !allChats[chatId]) return;
    currentChatId = chatId;
    
    chatWindow.innerHTML = '';
    allChats[chatId].forEach(msg => renderMessageUI(msg.text, msg.type));
    
    localStorage.setItem('sanlyTebip_currentChatId', currentChatId);
    renderHistory(); 

    if (window.innerWidth < 1023 && sidebar && sidebar.classList.contains('sidebar-open')) {
        toggleSidebar();
    }
}

// --- 5. UI RENDER FUNKSIÝALARY ---

function formatBotText(text) {
    if (!text) return "";

    return text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/BIOLOGIK HÄSIÝETNAMASY:/g, '<span class="section-title">BIOLOGIK HÄSIÝETNAMASY:</span>')
        .replace(/GEOGRAFIKI ÝAÝRAWY:/g, '<span class="section-title">GEOGRAFIKI ÝAÝRAWY:</span>')
        .replace(/BIO-HIMIKI DÜZÜMI:/g, '<span class="section-title">BIO-HIMIKI DÜZÜMI:</span>')
        .replace(/ŞYPALYLYK HÄSIÝETI:/g, '<span class="section-title">ŞYPALYLYK HÄSIÝETI:</span>')
        .replace(/DERMANYŇ TAÝÝARLANYLYŞY:/g, '<span class="section-title text-special">DERMANYŇ TAÝÝARLANYLYŞY:</span>')
        .replace(/SOŇLAMA:/g, '')
        .replace(/\n/, '<br>');
}

function renderMessageUI(text, type) {
    const isUser = type === 'user';
    const msgDiv = document.createElement('div');

    msgDiv.className = `flex items-start gap-6 max-w-4xl mx-auto message-appear mb-6 ${isUser ? 'flex-row-reverse' : ''}`;
    const finalText = !isUser ? formatBotText(text) : text;

    msgDiv.innerHTML = `
        <div class="w-14 h-14 rounded-2xl ${isUser ? 'bg-slate-200 dark:bg-white/10 text-slate-500' : 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white'} flex-shrink-0 flex items-center justify-center shadow-lg text-2xl">
            ${isUser ? '👤' : '👨‍⚕️'}
        </div>
        <div class="space-y-3 pt-1 ${isUser ? 'text-right' : 'text-left'}">
            <div class="${isUser ? 'bg-emerald-600 text-white shadow-emerald-200' : 'bg-white/[0.03] backdrop-blur-3xl border border-white/10 text-slate-100'} p-7 rounded-[2.2rem] ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'} shadow-2xl leading-relaxed text-[17px] inline-block text-left max-w-full">
                ${finalText}
            </div>
        </div>
    `;

    chatWindow.appendChild(msgDiv);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderTypewriter(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex items-start gap-6 max-w-4xl mx-auto message-appear mb-6`;

    msgDiv.innerHTML = `
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white flex-shrink-0 flex items-center justify-center shadow-xl text-2xl">
            👨‍⚕️
        </div>
        <div class="space-y-3 pt-1 text-left">
            <div class="typing-box bg-white/[0.03] backdrop-blur-3xl border border-white/10 text-slate-100 p-7 rounded-[2.2rem] rounded-tl-none shadow-2xl leading-relaxed text-[17px]"></div>
        </div>
    `;

    chatWindow.appendChild(msgDiv);
    const target = msgDiv.querySelector('.typing-box');
    const formattedText = formatBotText(text);
    let i = 0;

    function type() {
        if (i < formattedText.length) {
            target.innerHTML = formattedText.substring(0, i + 1);
            i++;
            chatWindow.scrollTop = chatWindow.scrollHeight;
            setTimeout(type, 8);
        }
    }
    type();
}

function updateRightPanel(data) {
    const plants = Array.isArray(data.plants) ? data.plants : [];
    if (plants.length === 0) return;

    const mainPlant = plants[0];
    const name = typeof mainPlant === 'object' ? mainPlant.ady_tm : mainPlant;
    const desc = mainPlant.dusundiris || "Dermanlyk ösümlik barada maglumat.";
    const fileName = mainPlant.surat_fayl || (name.toLowerCase().replace(/\s+/g, '_') + '.jpg');

    if (plantTitle) plantTitle.innerText = name.toUpperCase();
    if (plantDescription) plantDescription.innerText = desc;

    if (imageDisplay) {
        imageDisplay.innerHTML = ""; 
        imageDisplay.className = "relative w-full h-[380px] bg-[#0f172a]/50 flex items-center justify-center overflow-hidden border-b border-white/5";

        const img = document.createElement('img');
        img.className = "w-full h-full object-cover transition-all duration-700 opacity-0 scale-95";
        img.src = `./assets/plants/${fileName}`;
        
        img.onload = () => {
            img.classList.remove('opacity-0', 'scale-95');
            img.classList.add('opacity-100', 'scale-100');
        };

        img.onerror = () => {
            img.src = `./assets/surat/sanly-tebip.jpg`; 
            img.classList.remove('opacity-0', 'scale-95');
            img.classList.add('opacity-100', 'scale-100');
        };
        
        imageDisplay.appendChild(img);
    }

    if (aiSuggestions) {
        aiSuggestions.innerHTML = plants.map(p => {
            const pName = typeof p === 'object' ? p.ady_tm : p;
            return `
                <div class="flex items-center gap-3 bg-emerald-500/10 p-4 rounded-2xl mb-2 border border-emerald-500/10 hover:border-emerald-500/40 transition-colors">
                    <span class="text-sm font-bold text-slate-200">${pName}</span>
                </div>
            `;
        }).join('');
    }
}

function resetRightPanel() {
    if (plantTitle) plantTitle.innerText = "ÖSÜMLIK ADY";
    if (plantDescription) plantDescription.innerText = "";
    if (imageDisplay) imageDisplay.innerHTML = '<img src="https://img.icons8.com/color/144/natural-food.png" class="w-32 opacity-[0.08]" alt="">';
}

function showLoading() {
    const loader = document.createElement('div');
    loader.className = "flex gap-2 p-6 max-w-4xl mx-auto bot-loading";
    loader.innerHTML = `
        <div class="w-2 h-2 bg-emerald-500 rounded-full animate-bounce"></div>
        <div class="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div class="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
    `;
    chatWindow.appendChild(loader);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return loader;
}

// --- 6. SIDEBAR DOLANDYRYŞ ---
function toggleSidebar() {
    if (!sidebar) return;
    const isOpen = sidebar.classList.contains('sidebar-open');

    if (!isOpen) {
        sidebar.classList.remove('w-20');
        sidebar.classList.add('w-80', 'sidebar-open');
        if (sidebarOverlay) sidebarOverlay.classList.remove('hidden');
    } else {
        sidebar.classList.remove('w-80', 'sidebar-open');
        sidebar.classList.add('w-20');
        if (sidebarOverlay) sidebarOverlay.classList.add('hidden');
    }
}

// --- 7. HADYSALARY BAGLAMAK (EVENT LISTENERS) ---

if (sendBtn) sendBtn.onclick = sendToAI;
if (userMsgInput) {
    userMsgInput.onkeydown = (e) => { 
        if (e.key === 'Enter') {
            e.preventDefault();
            sendToAI(); 
        }
    };
}

// --- SES ÝAZGY WE SERWERE UGRATMAK LOGIKASY ---
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

if (startRecordBtn) {
    startRecordBtn.addEventListener('click', async () => {
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                
                // Telefonlar üçin iň amatly formaty awtomatiki saýlaýança barlag
                let options = { mimeType: 'audio/webm' };
                if (!MediaRecorder.isTypeSupported('audio/webm')) {
                    if (MediaRecorder.isTypeSupported('audio/mp4')) {
                        options = { mimeType: 'audio/mp4' }; // Android üçin has laýyk
                    } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
                        options = { mimeType: 'audio/ogg' };
                    } else {
                        options = {}; // Hiç biri bolmasa deslapky görnüşi
                    }
                }

                mediaRecorder = new MediaRecorder(stream, options);
                audioChunks = [];

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                    }
                };

                mediaRecorder.onstop = async () => {
                    // Góreç (mimeType) nähili açylan bolsaş şoňa görä Blob döretmek
                    const audioBlob = new Blob(audioChunks, { type: options.mimeType || 'audio/webm' });
                    await sendAudioToServer(audioBlob);
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                isRecording = true;
                startRecordBtn.classList.add('bg-red-500', 'animate-pulse');
                if (recordingStatus) recordingStatus.innerText = "🔴 Ses ýazylýar... Duruzmak üçin ýene basyň.";
            } catch (err) {
                console.error(err);
                alert("Mikrofona rugsat berilmedi ýa-da mikrofon tapylmady!");
            }
        } else {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
            isRecording = false;
            startRecordBtn.classList.remove('bg-red-500', 'animate-pulse');
            if (recordingStatus) recordingStatus.innerText = "";
        }
    });
}

async function sendAudioToServer(audioBlob) {
    const formData = new FormData();
    // Serweriň nähili at bilen garaşýandygyna bagly (mysal üçin 'audio' ýa-da 'file')
    formData.append('audio', audioBlob, 'voice-message.webm');
    
    // Eger inputda tekst bar bolsa goş, ýogsam "Sesli habar" diýip iber
    let promptText = "";
    if (userMsgInput && userMsgInput.value.trim() !== "") {
        promptText = userMsgInput.value.trim();
        userMsgInput.value = '';
    } else {
        promptText = "Sesli habar"; 
    }
    
    formData.append('prompt', promptText);
    checkOrCreateChat(promptText);

    try {
        if (chatWindow) {
            renderMessageUI("⏳ Ses analiz edilýär...", 'bot-loading');
        }

        // Bellik: FormData ugradylanda 'Content-Type' header-i ýazylmaýar! 
        // Brauzer ony özbaşdak multipart/form-data edip sazlaýar.
        const response = await fetch(`${BASE_URL}/api/tebip-audio`, {
            method: 'POST',
            body: formData
        });

        const contentType = response.headers.get("content-type");
        const loadingElement = document.querySelector('.bot-loading');
        if (loadingElement) loadingElement.remove();

        if (contentType && contentType.includes("application/json")) {
            const data = await response.json();
            
            // DÜZETME: data.text ýerine serwerden gelýän data.response ulanylmaly
            displayResponseMessage(data);
            saveToMemory(currentChatId, data.response, 'bot');
        } else {
            throw new Error("Serwer ýalňyş jogap gaýtardy.");
        }

    } catch (error) {
        const loadingElement = document.querySelector('.bot-loading');
        if (loadingElement) loadingElement.remove();

        alert("Maglumat ugradylanda ýalňyşlyk boldy: " + error.message);
        if (chatWindow) {
            renderMessageUI("Baglanyşykda ýa-da serwerde säwlik ýüze çykdy.", 'bot');
        }
    }
}

function displayResponseMessage(data) {
    if (chatWindow) {
        // DÜZETME: data.text ýerine data.response görkezilýär
        renderMessageUI(data.response, 'bot');
        if (data.plants && data.plants.length > 0) {
            updateRightPanel(data);
        }
    }
}