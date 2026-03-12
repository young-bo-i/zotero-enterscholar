var PLUGIN_ID;
var rootURI;

var _sectionState = {
	original: '',
	translated: '',
	loading: false,
	error: '',
};
var _sectionRefresh = null;

function install(data, reason) {}

function uninstall(data, reason) {}

async function startup({ id, version, rootURI: uri }) {
	PLUGIN_ID = id;
	rootURI = uri;
	
	Services.scriptloader.loadSubScript(rootURI + 'content/config.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/auth.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/translate.js');
	
	await Zotero.EnterScholar.Config.init();
	
	let win = Zotero.getMainWindow();
	if (win) {
		win.MozXULElement.insertFTLIfNeeded('enterscholar.ftl');
	}
	
	await Zotero.PreferencePanes.register({
		pluginID: PLUGIN_ID,
		src: rootURI + 'content/preferences.xhtml',
		id: 'enterscholar-preferences',
		scripts: [rootURI + 'content/preferences.js'],
		stylesheets: [rootURI + 'content/preferences.css'],
	});
	
	try {
		_registerReaderPopup();
		_registerReaderContextMenu();
		_registerMainMenus();
		_registerTranslateSection();
	}
	catch (e) {
		Zotero.logError(e);
	}
}

function shutdown({ id }) {}

function onMainWindowLoad({ window }) {
	window.MozXULElement.insertFTLIfNeeded('enterscholar.ftl');
}

function onMainWindowUnload({ window }) {}

// ── Reader popup ──

function _registerReaderPopup() {
	Zotero.Reader.registerEventListener('renderTextSelectionPopup', (event) => {
		let { reader, doc, params, append } = event;
		let text = params.annotation?.text;
		if (!text || !text.trim()) return;
		
		_updateTranslateSection(text.trim());
		
		if (!Zotero.Prefs.get('extensions.enterscholar.enableReaderPopup', true)) {
			return;
		}
		
		let wrapper = doc.createElement('div');
		wrapper.style.cssText = 'border-top: 1px solid var(--fill-quinary);';
		
		let header = doc.createElement('div');
		header.style.cssText = [
			'padding: 8px 14px 0',
			'font-weight: 600',
			'color: var(--fill-secondary)',
			'font-size: 11px',
			'text-transform: uppercase',
			'letter-spacing: 0.5px',
		].join(';');
		header.textContent = '恩特学术';
		wrapper.appendChild(header);
		
		let container = doc.createElement('div');
		container.style.cssText = [
			'padding: 6px 14px 10px',
			'font-size: 13px',
			'line-height: 1.6',
			'white-space: pre-wrap',
			'word-break: break-word',
			'overflow-wrap: break-word',
			'overflow: auto',
			'resize: both',
			'min-height: 60px',
			'height: 120px',
			'min-width: 200px',
			'max-height: 600px',
			'user-select: text',
		].join(';');
		
		let config = Zotero.EnterScholar.Config.getActiveConfig();
		if (!config) {
			let tip = doc.createElement('div');
			tip.textContent = '未配置翻译服务';
			tip.style.cssText = 'color: var(--fill-secondary); margin-bottom: 8px;';
			container.appendChild(tip);
			
			let btn = doc.createElement('button');
			btn.textContent = '前往设置';
			btn.style.cssText = [
				'padding: 4px 16px',
				'border: 1px solid var(--fill-quinary)',
				'border-radius: 6px',
				'background: var(--material-background, transparent)',
				'color: var(--fill-primary)',
				'font-size: 12px',
				'cursor: pointer',
			].join(';');
			btn.addEventListener('click', () => {
				Zotero.Utilities.Internal.openPreferences('enterscholar-preferences');
			});
			container.appendChild(btn);
			wrapper.appendChild(container);
			append(wrapper);
			return;
		}
		
		let content = doc.createElement('div');
		content.textContent = '翻译中…';
		content.style.color = 'var(--fill-secondary)';
		container.appendChild(content);
		wrapper.appendChild(container);
		append(wrapper);
		
		Zotero.EnterScholar.Translate.translate(text, (partial, done) => {
			content.textContent = partial || '翻译中…';
			if (done) {
				content.style.color = '';
			}
		}).catch((e) => {
			Zotero.logError(e);
			content.textContent = _getUserFriendlyError(e.message);
			content.style.color = 'var(--accent-red)';
		});
	}, PLUGIN_ID);
}

// ── Reader context menu ──

function _registerReaderContextMenu() {
	Zotero.Reader.registerEventListener('createAnnotationContextMenu', (event) => {
		if (!Zotero.Prefs.get('extensions.enterscholar.enableContextMenu', true)) {
			return;
		}
		
		let { reader, params, append } = event;
		append({
			label: '恩特学术',
			onCommand: async () => {
				let annotations = reader._item.getAnnotations();
				let texts = [];
				for (let id of params.ids) {
					let ann = annotations.find(a => a.key === id);
					if (ann) {
						let t = ann.getField('annotationText');
						if (t) texts.push(t);
					}
				}
				let selectedText = texts.join('\n');
				if (!selectedText) return;
				
				try {
					let result = await Zotero.EnterScholar.Translate.translate(selectedText);
					Services.prompt.alert(null, '恩特学术', result);
				}
				catch (e) {
					Zotero.logError(e);
					Services.prompt.alert(null, '恩特学术', _getUserFriendlyError(e.message));
				}
			}
		});
	}, PLUGIN_ID);
}

// ── Tools menu ──

function _registerMainMenus() {
	if (!Zotero.MenuManager) return;
	
	Zotero.MenuManager.registerMenu({
		pluginID: PLUGIN_ID,
		menuID: 'enterscholar-tools-menu',
		target: 'main/menubar/tools',
		menus: [
			{
				menuType: 'submenu',
				l10nID: 'enterscholar-translate-menu-label',
				menus: [
					{
						menuType: 'menuitem',
						l10nID: 'enterscholar-login-button',
						onShowing: (ev, ctx) => {
							ctx.setVisible(!Zotero.EnterScholar.Auth.isLoggedIn);
						},
						onCommand: async () => {
							try {
								await Zotero.EnterScholar.Auth.login();
								Zotero.EnterScholar.Config.clearCache();
							}
							catch (e) {
								Zotero.logError(e);
								if (e.message !== '登录已取消') {
									Services.prompt.alert(null, '恩特学术', _getUserFriendlyError(e.message));
								}
							}
						},
					},
					{
						menuType: 'menuitem',
						l10nID: 'enterscholar-logout-button',
						onShowing: (ev, ctx) => {
							ctx.setVisible(Zotero.EnterScholar.Auth.isLoggedIn);
						},
						onCommand: async () => {
							await Zotero.EnterScholar.Auth.logout();
							Zotero.EnterScholar.Config.clearCache();
							Zotero.EnterScholar.Translate.clearCache();
						},
					},
					{ menuType: 'separator' },
					{
						menuType: 'menuitem',
						l10nID: 'enterscholar-check-usage',
						onShowing: (ev, ctx) => {
							ctx.setEnabled(Zotero.EnterScholar.Auth.isLoggedIn);
						},
						onCommand: async () => {
							try {
								let usage = await Zotero.EnterScholar.Config.fetchUsage(true);
								if (usage) {
									let msg = _formatUsageMessage(usage);
									Services.prompt.alert(null, '恩特学术 — 使用额度', msg);
								}
								else {
									Services.prompt.alert(null, '恩特学术', '暂时无法获取额度信息，请稍后再试');
								}
							}
							catch (e) {
								Zotero.logError(e);
								Services.prompt.alert(null, '恩特学术', _getUserFriendlyError(e.message));
							}
						},
					},
				],
			},
		],
	});
}

// ── Item pane translate section (right sidebar) ──

function _registerTranslateSection() {
	if (!Zotero.ItemPaneManager) return;
	
	Zotero.ItemPaneManager.registerSection({
		paneID: 'enterscholar-translate',
		pluginID: PLUGIN_ID,
		header: {
			l10nID: 'enterscholar-section-header',
			icon: rootURI + 'content/icons/icon.svg',
		},
		sidenav: {
			l10nID: 'enterscholar-section-sidenav',
			icon: rootURI + 'content/icons/icon.svg',
		},
		sectionButtons: [
			{
				type: 'copy',
				icon: 'chrome://zotero/skin/16/universal/copy.svg',
				l10nID: 'enterscholar-section-copy',
				onClick: ({ body }) => {
					let transEl = body.querySelector('#es-section-translation');
					let text = transEl?.textContent;
					if (text && text !== '翻译中…') {
						let clipboard = Cc['@mozilla.org/widget/clipboardhelper;1']
							.getService(Ci.nsIClipboardHelper);
						clipboard.copyString(text);
					}
				},
			},
		],
		onInit: ({ refresh }) => {
			_sectionRefresh = refresh;
		},
		onDestroy: () => {
			_sectionRefresh = null;
		},
		onItemChange: ({ setEnabled }) => {
			setEnabled(true);
			return false;
		},
		onRender: ({ body, doc }) => {
			body.textContent = '';
			
			let state = _sectionState;
			
			if (!state.original) {
				let hint = doc.createElement('div');
				hint.textContent = '在阅读器中选中文本即可翻译';
				hint.style.cssText = 'color: var(--fill-secondary); padding: 6px 0; font-size: 13px;';
				body.appendChild(hint);
				return;
			}
			
			let origLabel = doc.createElement('div');
			origLabel.textContent = '原文';
			origLabel.style.cssText = 'font-size: 11px; color: var(--fill-secondary); margin-bottom: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;';
			body.appendChild(origLabel);
			
			let origBox = doc.createElement('div');
			origBox.textContent = state.original;
			origBox.style.cssText = 'font-size: 13px; line-height: 1.6; padding: 8px 10px; background: var(--material-mix-quinary); border-radius: 6px; margin-bottom: 12px; max-height: 150px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; user-select: text;';
			body.appendChild(origBox);
			
			let transLabel = doc.createElement('div');
			transLabel.textContent = '译文';
			transLabel.style.cssText = 'font-size: 11px; color: var(--fill-secondary); margin-bottom: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;';
			body.appendChild(transLabel);
			
			let transBox = doc.createElement('div');
			transBox.id = 'es-section-translation';
			transBox.style.cssText = 'font-size: 13px; line-height: 1.6; padding: 8px 10px; border-radius: 6px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; user-select: text;';
			
			if (state.error) {
				transBox.textContent = state.error;
				transBox.style.color = 'var(--accent-red)';
			}
			else if (state.translated) {
				transBox.textContent = state.translated;
			}
			else {
				transBox.textContent = '翻译中…';
				transBox.style.color = 'var(--fill-secondary)';
			}
			body.appendChild(transBox);
		},
		onAsyncRender: async ({ body }) => {
			let state = _sectionState;
			if (!state.original || state.translated || state.error) return;
			
			let transBox = body.querySelector('#es-section-translation');
			if (!transBox) return;
			
			let config = Zotero.EnterScholar.Config.getActiveConfig();
			if (!config) {
				state.error = '尚未配置翻译服务';
				transBox.textContent = state.error;
				transBox.style.color = 'var(--accent-red)';
				return;
			}
			
			try {
				state.loading = true;
				let result = await Zotero.EnterScholar.Translate.translate(
					state.original,
					(partial, done) => {
						if (transBox) {
							transBox.textContent = partial || '翻译中…';
							if (done) {
								transBox.style.color = '';
							}
						}
					}
				);
				state.translated = result;
				state.loading = false;
			}
			catch (e) {
				Zotero.logError(e);
				state.error = _getUserFriendlyError(e.message);
				state.loading = false;
				if (transBox) {
					transBox.textContent = state.error;
					transBox.style.color = 'var(--accent-red)';
				}
			}
		},
	});
}

function _updateTranslateSection(text) {
	if (!text) return;
	_sectionState = {
		original: text,
		translated: '',
		loading: true,
		error: '',
	};
	if (_sectionRefresh) {
		_sectionRefresh();
	}
}

// ── Helpers ──

function _getUserFriendlyError(msg) {
	if (!msg) return '翻译失败，请稍后重试';
	if (msg.includes('登录授权失败')) return '登录失败，请重试';
	return msg;
}

function _formatUsageMessage(usage) {
	let lines = [];
	if (usage.username) {
		lines.push(`用户: ${usage.username}`);
	}
	if (usage.daily_quota !== undefined) {
		lines.push(`今日已用: ${usage.used_today || 0} / ${usage.daily_quota}`);
		lines.push(`剩余: ${usage.remaining ?? (usage.daily_quota - (usage.used_today || 0))}`);
	}
	if (usage.trust_level !== undefined) {
		lines.push(`信任等级: ${usage.trust_level}`);
	}
	if (lines.length === 0) {
		lines.push(JSON.stringify(usage, null, 2));
	}
	return lines.join('\n');
}
