# Manga Universal Translator (English/Korean to Thai)

[*คลิกที่นี่สำหรับภาษาไทย (Thai Version) -> README_TH.md*](README_TH.md)

An automatic web manga translation system that translates manga pages from English/Korean into Thai directly in your browser. Powered by an intelligent Multi-pass OCR engine and advanced AI translations (Gemini / Local Ollama). Features remote processing support, allowing you to use your computer's GPU/CPU to translate on mobile devices (iOS Safari & Android Kiwi Browser).

---

## 🌟 Key Features

*   **Premium Floating UI:** Sleek glassmorphism-styled floating control bar to toggle translation, switch source languages (EN/KO), and select translation models dynamically.
*   **Multi-pass OCR Engine:** Blends the capabilities of EasyOCR and PaddleOCR to achieve high-accuracy text detection for both vertical and horizontal layouts.
*   **Viterbi Word Segmenter & Offline Dictionary:** Intelligent word splitter and spelling corrector to fix spacing/tokenization issues and merge words seamlessly.
*   **Advanced AI Translation:** Supports multiple translation options:
    *   **Gemini 2.5 Flash API** (Recommended - Best context-aware translations)
    *   **Local AI (Ollama)** e.g., Llama 3 8B, Gemma 2 9B, Qwen 2.5/3 (Free, private, runs locally)
    *   **Google Translate Fallback** (Used when API quotas are exhausted)
*   **Mobile Remote Translation:** Translate on your phone (iOS Safari / Android Kiwi) using your PC as the backend processor via local Wi-Fi or ngrok tunnels.

---

## 💻 Backend Setup

### One-Click Interactive Setup
1.  **Configure API Keys (Optional):**
    Create a file named `.env` in the root folder of the project and add your Gemini API Key:
    ```env
    GEMINI_API_KEY=your_actual_gemini_api_key_here
    ```
2.  **Start the Server with the Intelligent Setup Script:**
    Double-click **`run_backend.bat`** in the root folder.
    *   **Automated Toolchain Installer:** If Python 3.11 or other prerequisites are missing from your computer, the launcher script will automatically download and install Python and setup tools silently.
    *   **Interactive Model Downloader:** During installation, the CMD window will prompt you to select which OCR models (EasyOCR, PaddleOCR, or both) and local AI translation models (Llama 3, Gemma 2, Qwen 2.5, Qwen 3, or skip) you want to download. It will auto-install Ollama and pull your selected models in a single flow.
    *   Once setup completes, the backend server starts running automatically at `http://0.0.0.0:8000`.

---

## 🔌 PC Extension Setup

1.  Open **Google Chrome** (or other Chromium-based browsers like Edge, Brave).
2.  Navigate to the extensions manager page: `chrome://extensions/`.
3.  Enable **Developer Mode** using the toggle switch in the top-right corner.
4.  Click **Load unpacked** in the top-left corner.
5.  Select the **`extension`** folder inside this project directory.
6.  Open any manga webpage; the premium floating control bar will appear in the bottom-right corner.

---

## 📱 Mobile Devices Setup

You can link your mobile browser to your computer's translation server in two ways:

### 🤖 Method 1: Android (via Kiwi Browser)
1.  Install **Kiwi Browser** from the Google Play Store on your Android device.
2.  Open Kiwi Browser, go to `chrome://extensions/`, and enable Developer Mode.
3.  Install the extension by uploading a `.zip` file of the `extension` folder.
4.  Open a manga page, tap the **Settings Gear** on the floating control bar.
5.  Enter your PC's IP address (e.g., `http://192.168.1.109:8000` - find your IP using `ipconfig` in Command Prompt) and tap **Save**.

---

### 🍏 Method 2: iOS (via Safari + Userscripts App)
Due to iOS security policies (WebKit constraints), local extensions cannot be loaded directly. You must run the translation logic as a Userscript:

1.  Download the free **Userscripts** app from the App Store on your iPhone/iPad.
2.  Enable the extension: `Settings > Safari > Extensions > enable Userscripts` (set website permissions to **Always Allow**).
3.  Open the **Userscripts** app (orange icon on the home screen) and select a local directory in the iOS Files app (e.g., create a folder named `Userscripts`).
4.  Open Safari and navigate to your PC's server address:
    ```text
    http://<YOUR_PC_IP_ADDRESS>:8000/manga-translator.user.js
    ```
5.  The Userscripts extension installer will pop up. Tap **Install** (or **Save**) to add the script.
6.  Open a manga website in Safari; the floating control bar will appear in the bottom-right. Tap the **Settings Gear**, enter your PC's IP address (or ngrok HTTPS link), and click Save to start translating!

---

## 🔒 Bypassing iOS Safari Security with "ngrok" (HTTPS Tunnel)
If the translation unblurs quickly without translating on Safari, it's due to **Mixed Content Blocking** (Safari blocks insecure `http://` fetch requests from secure `https://` webpages).

You can solve this easily by tunneling your local server through **ngrok**:

1.  Download **[ngrok for Windows](https://ngrok.com/)** and sign up for a free account.
2.  Configure your authtoken (found on the ngrok dashboard):
    ```bash
    ngrok config add-authtoken <YOUR_AUTHTOKEN>
    ```
3.  Tunnel port 8000 using:
    ```bash
    ngrok http 8000
    ```
4.  Copy the secure **Forwarding** HTTPS URL (e.g., `https://xxxx.ngrok-free.app`).
5.  On your iPhone/iPad, use this link to download the script (`https://xxxx.ngrok-free.app/manga-translator.user.js`) and paste it in the **Settings Gear** of the floating UI. This allows translating securely anywhere (even outside your home Wi-Fi network).

---

## 🛠️ Project Directory Structure
```text
manga-translator/
├── backend/
│   ├── app.py                     # Main FastAPI server script
│   ├── english_words.txt          # Word segmenter reference list
│   └── english_words_large.txt    # Large reference dictionary for verbs/compounds
├── extension/
│   ├── content.script.js          # Injected content script (main translator logic)
│   ├── manifest.json              # Extension manifest (v3)
│   ├── popup.html                 # Extension popup interface
│   └── popup.js                   # Popup execution script
├── userscript/
│   └── manga-translator.user.js   # Tampermonkey userscript for Safari iOS
├── run_backend.bat                # Automated launcher script for Windows
├── README_TH.md                   # Thai User Manual
└── README.md                      # English User Manual (this file)
```
