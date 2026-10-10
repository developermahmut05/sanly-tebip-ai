const { app, BrowserWindow } = require('electron');
const path = require('path');
const dotenv = require('dotenv');

// .env faýlyň dogry ýoluny kesgitleýäris
const envPath = process.resourcesPath 
    ? path.join(process.resourcesPath, '.env') 
    : path.join(__dirname, '.env');

dotenv.config({ path: envPath });

// Express serweri (server.js) awtomatiki işledýäris
require('./server.js'); 

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Serweriň başlaryna garaşyp URL ýükleýäris (Portuňyz 3000 däl bolsa, öz portuňyzy ýazyň)
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:5000');
    }, 800);
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});