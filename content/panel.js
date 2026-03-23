/* global Zotero, XULElementBase, MozXULElement, customElements, Cc, Ci */

(function () {
	"use strict";
	
	var LANGUAGES = [
		{ value: 'zh-CN', label: '简体中文' },
		{ value: 'zh-TW', label: '繁体中文' },
		{ value: 'en', label: 'English' },
		{ value: 'ja', label: '日本語' },
		{ value: 'ko', label: '한국어' },
		{ value: 'fr', label: 'Français' },
		{ value: 'de', label: 'Deutsch' },
		{ value: 'es', label: 'Español' },
		{ value: 'ru', label: 'Русский' },
		{ value: 'pt', label: 'Português' },
		{ value: 'ar', label: 'العربية' },
	];
	
	var ICON_COPY = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
	var ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
	var ICON_REFRESH = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
	
	class EnterscholarPanel extends XULElementBase {
		_initialized = false;
		_needsRetranslate = false;
		
		connectedCallback() {
			try {
				Zotero.UIProperties.registerRoot(this);
			}
			catch (e) {}
			super.connectedCallback();
		}
		
		get content() {
			let base = Zotero.EnterScholar?._rootURI || '';
			let langOptions = LANGUAGES.map(
				l => `<menuitem label="${l.label}" value="${l.value}" />`
			).join('\n');
			
			return MozXULElement.parseXULToFragment(`
				<linkset>
					<html:link rel="stylesheet" href="${base}content/panel.css" />
				</linkset>
				<vbox class="es-panel">
					<hbox id="es-settings-bar" class="es-settings-bar" align="center">
						<checkbox id="es-auto-toggle"
							native="true"
							label="自动翻译" />
						<spacer flex="1" />
						<menulist id="es-lang-select" native="true" style="max-width: 120px;">
							<menupopup>
								${langOptions}
							</menupopup>
						</menulist>
					</hbox>
					<html:div id="es-login-bar" class="es-login-bar" hidden="true">
						<html:span class="es-login-text">未登录恩特学术</html:span>
						<html:button id="es-login-btn" class="es-login-btn">登录</html:button>
					</html:div>
					<html:div id="es-hint" class="es-hint">
						在阅读器中选中文本即可翻译
					</html:div>
					<vbox id="es-text-container" class="es-text-container" hidden="true" flex="1">
						<html:div class="es-text-box-wrapper">
							<html:div class="es-text-box-header">
								<html:span class="es-text-box-label">原文</html:span>
								<html:button id="es-copy-original" class="es-icon-btn" title="复制原文"></html:button>
							</html:div>
							<html:div id="es-original" class="es-text-box"></html:div>
						</html:div>
						<html:div class="es-divider"></html:div>
						<html:div class="es-text-box-wrapper">
							<html:div class="es-text-box-header">
								<html:span class="es-text-box-label">译文</html:span>
								<html:div class="es-header-actions">
									<html:button id="es-retranslate" class="es-icon-btn es-retranslate-btn" title="重新翻译" hidden="true"></html:button>
									<html:button id="es-copy-translation" class="es-icon-btn" title="复制译文"></html:button>
								</html:div>
							</html:div>
							<html:div id="es-translation" class="es-text-box"></html:div>
						</html:div>
					</vbox>
				</vbox>
			`);
		}
		
		init() {
			let copyOrigBtn = this.querySelector('#es-copy-original');
			let copyTransBtn = this.querySelector('#es-copy-translation');
			let retranslateBtn = this.querySelector('#es-retranslate');
			
			if (copyOrigBtn) {
				copyOrigBtn.innerHTML = ICON_COPY;
				copyOrigBtn.addEventListener('click', () => {
					this._copyWithFeedback(this.querySelector('#es-original'), copyOrigBtn);
				});
			}
			if (copyTransBtn) {
				copyTransBtn.innerHTML = ICON_COPY;
				copyTransBtn.addEventListener('click', () => {
					this._copyWithFeedback(this.querySelector('#es-translation'), copyTransBtn);
				});
			}
			if (retranslateBtn) {
				retranslateBtn.innerHTML = ICON_REFRESH;
				retranslateBtn.addEventListener('click', () => {
					this._onRetranslate();
				});
			}
			
			let loginBtn = this.querySelector('#es-login-btn');
			if (loginBtn) {
				loginBtn.addEventListener('click', () => {
					this._doLogin();
				});
			}
			
			let autoToggle = this.querySelector('#es-auto-toggle');
			if (autoToggle) {
				autoToggle.addEventListener('command', () => {
					Zotero.Prefs.set('extensions.enterscholar.autoTranslate', autoToggle.checked, true);
				});
			}
			
			let langSelect = this.querySelector('#es-lang-select');
			if (langSelect) {
				langSelect.addEventListener('command', () => {
					let newLang = langSelect.value;
					Zotero.Prefs.set('extensions.enterscholar.targetLanguage', newLang, true);
					this._onLangChanged();
				});
			}
			
			this._initialized = true;
		}
		
		destroy() {
			this._initialized = false;
		}
		
		async _doLogin() {
			let loginBtn = this.querySelector('#es-login-btn');
			if (loginBtn) {
				loginBtn.disabled = true;
				loginBtn.textContent = '登录中…';
			}
			try {
				await Zotero.EnterScholar.Auth.login();
				this._syncLoginState();
			}
			catch (e) {
				Zotero.logError('[EnterScholar] login error: ' + e);
			}
			finally {
				if (loginBtn) {
					loginBtn.disabled = false;
					loginBtn.textContent = '登录';
				}
			}
		}
		
		_syncLoginState() {
			let loginBar = this.querySelector('#es-login-bar');
			if (!loginBar) return;
			try {
				let loggedIn = Zotero.EnterScholar.Auth.isLoggedIn;
				loginBar.hidden = loggedIn;
			}
			catch (e) {
				loginBar.hidden = false;
			}
		}
		
		_copyWithFeedback(sourceEl, btn) {
			let text = sourceEl?.textContent;
			if (!text) return;
			try {
				let clipboard = Cc['@mozilla.org/widget/clipboardhelper;1']
					.getService(Ci.nsIClipboardHelper);
				clipboard.copyString(text);
			}
			catch (e) {
				Zotero.logError('[EnterScholar] copy error: ' + e);
				return;
			}
			btn.innerHTML = ICON_CHECK;
			btn.classList.add('es-copied');
			setTimeout(() => {
				btn.innerHTML = ICON_COPY;
				btn.classList.remove('es-copied');
			}, 1500);
		}
		
		_hasVisibleTranslation() {
			let transEl = this.querySelector('#es-translation');
			if (!transEl || !transEl.textContent) return false;
			return !transEl.classList.contains('es-placeholder')
				&& !transEl.classList.contains('es-loading');
		}
		
		_onLangChanged() {
			let origEl = this.querySelector('#es-original');
			let retranslateBtn = this.querySelector('#es-retranslate');
			if (!retranslateBtn) return;
			
			if (origEl?.textContent && this._hasVisibleTranslation()) {
				this._needsRetranslate = true;
				retranslateBtn.hidden = false;
			}
			else {
				this._needsRetranslate = false;
				retranslateBtn.hidden = true;
			}
		}
		
		_onRetranslate() {
			this._needsRetranslate = false;
			let retranslateBtn = this.querySelector('#es-retranslate');
			if (retranslateBtn) retranslateBtn.hidden = true;
			
			let origEl = this.querySelector('#es-original');
			let text = origEl?.textContent;
			if (!text) return;
			
			try {
				Zotero.EnterScholar._retranslate(text);
			}
			catch (e) {
				Zotero.logError('[EnterScholar] retranslate error: ' + e);
			}
		}
		
		render(state) {
			if (!this._initialized || !state) return;
			
			this._syncLoginState();
			
			let autoToggle = this.querySelector('#es-auto-toggle');
			let langSelect = this.querySelector('#es-lang-select');
			
			try {
				let autoOn = Zotero.Prefs.get('extensions.enterscholar.autoTranslate', true);
				if (autoToggle && autoToggle.checked !== autoOn) {
					autoToggle.checked = autoOn;
				}
				let currentLang = Zotero.EnterScholar?.Config?.getTargetLanguage() || 'zh-CN';
				if (langSelect && langSelect.value !== currentLang) {
					langSelect.value = currentLang;
				}
			}
			catch (e) {}
			
			let hint = this.querySelector('#es-hint');
			let textContainer = this.querySelector('#es-text-container');
			let retranslateBtn = this.querySelector('#es-retranslate');
			
			if (!state.original) {
				if (hint) hint.hidden = false;
				if (textContainer) textContainer.hidden = true;
				this._needsRetranslate = false;
				if (retranslateBtn) retranslateBtn.hidden = true;
			}
			else {
				if (hint) hint.hidden = true;
				if (textContainer) textContainer.hidden = false;
				
				let origEl = this.querySelector('#es-original');
				if (origEl) origEl.textContent = state.original;
				
				let transEl = this.querySelector('#es-translation');
				if (transEl) {
					transEl.className = 'es-text-box';
					if (state.error) {
						transEl.textContent = state.error;
						transEl.classList.add('es-error');
					}
					else if (state.translated) {
						transEl.textContent = state.translated;
						this._needsRetranslate = false;
						if (retranslateBtn) retranslateBtn.hidden = true;
					}
					else if (state.autoTriggered) {
						transEl.textContent = '翻译中…';
						transEl.classList.add('es-loading');
						this._needsRetranslate = false;
						if (retranslateBtn) retranslateBtn.hidden = true;
					}
					else {
						transEl.textContent = '点击翻译按钮开始翻译';
						transEl.classList.add('es-placeholder');
					}
				}
			}
		}
		
		getTranslationEl() {
			return this.querySelector('#es-translation');
		}
		
		showNoConfig() {
			let transEl = this.querySelector('#es-translation');
			if (transEl) {
				transEl.className = 'es-text-box es-error';
				transEl.textContent = '未配置翻译服务，请先登录恩特学术账号或在设置中配置自定义翻译服务';
			}
			let textContainer = this.querySelector('#es-text-container');
			if (textContainer) textContainer.hidden = false;
			let hint = this.querySelector('#es-hint');
			if (hint) hint.hidden = true;
		}
	}
	
	if (!customElements.get('enterscholar-panel')) {
		customElements.define('enterscholar-panel', EnterscholarPanel);
	}
})();
