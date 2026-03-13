var PLUGIN_ID;
var rootURI;

var _sectionState = {
	original: '',
	translated: '',
	loading: false,
	error: '',
	autoTriggered: false,
};
var _sectionInstances = [];

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


function _getAutoTranslate() {
	return Zotero.Prefs.get('extensions.enterscholar.autoTranslate', true);
}

function install(data, reason) {}

function uninstall(data, reason) {}

async function startup({ id, version, rootURI: uri }) {
	PLUGIN_ID = id;
	rootURI = uri;
	
	Services.scriptloader.loadSubScript(rootURI + 'content/config.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/auth.js');
	Services.scriptloader.loadSubScript(rootURI + 'content/translate.js');
	
	await Zotero.EnterScholar.Config.init();
	
	await Promise.all([
		Zotero.initializationPromise,
		Zotero.unlockPromise,
		Zotero.uiReadyPromise,
	]);
	
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
		// TODO: 右侧面板自定义 section 暂时禁用，后续再修复
		// _registerTranslateSection();
	}
	catch (e) {
		Zotero.logError('[EnterScholar] startup error: ' + e);
	}
}

function shutdown({ id }) {}

function onMainWindowLoad({ window }) {
	window.MozXULElement.insertFTLIfNeeded('enterscholar.ftl');
}

function onMainWindowUnload({ window }) {}

// ── Reader popup ──

function _widenSelectionPopup(wrapper) {
	try {
		let popup = wrapper.closest('.selection-popup');
		if (!popup) return;
		
		popup.style.maxWidth = 'min(90vw, 800px)';
		popup.style.width = '420px';
		popup.style.minWidth = '200px';
		
		let doc = wrapper.ownerDocument;
		let handleBar = doc.createElement('div');
		handleBar.style.cssText = 'display:flex;justify-content:center;padding:2px 0 4px;cursor:ew-resize;user-select:none;touch-action:none;';
		let grip = doc.createElement('div');
		grip.style.cssText = 'width:36px;height:4px;border-radius:2px;background:rgba(150,150,150,0.4);';
		handleBar.appendChild(grip);
		wrapper.appendChild(handleBar);
		
		let startX, startW;
		
		handleBar.addEventListener('pointerdown', (e) => {
			e.stopPropagation();
			e.preventDefault();
			startX = e.clientX;
			startW = popup.offsetWidth;
			handleBar.setPointerCapture(e.pointerId);
			grip.style.background = 'rgba(150,150,150,0.8)';
		});
		
		handleBar.addEventListener('pointermove', (e) => {
			if (!handleBar.hasPointerCapture(e.pointerId)) return;
			e.stopPropagation();
			e.preventDefault();
			let newW = Math.max(200, startW + (e.clientX - startX) * 2);
			popup.style.width = newW + 'px';
		});
		
		handleBar.addEventListener('pointerup', (e) => {
			e.stopPropagation();
			e.preventDefault();
			grip.style.background = 'rgba(150,150,150,0.4)';
			if (handleBar.hasPointerCapture(e.pointerId)) {
				handleBar.releasePointerCapture(e.pointerId);
			}
		});
		
		handleBar.addEventListener('lostpointercapture', () => {
			grip.style.background = 'rgba(150,150,150,0.4)';
			startX = startW = undefined;
		});
	}
	catch (e) {
		Zotero.logError('[EnterScholar] _widenSelectionPopup error: ' + e);
	}
}

function _registerReaderPopup() {
	Zotero.Reader.registerEventListener('renderTextSelectionPopup', (event) => {
		let { reader, doc, params, append } = event;
		let text = params.annotation?.text;
		if (!text || !text.trim()) return;
		
		let autoTranslate = _getAutoTranslate();
		_updateTranslateSection(text.trim(), autoTranslate);
		
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
		header.textContent = 'Translation of Enterscholar';
		wrapper.appendChild(header);
		
		let container = doc.createElement('div');
		container.style.cssText = [
			'padding: 6px 14px 10px',
			'font-size: 13px',
			'line-height: 1.6',
			'white-space: pre-wrap',
			'word-break: break-word',
			'overflow-wrap: break-word',
			'max-height: 300px',
			'overflow-y: auto',
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
			btn.style.cssText = _buttonStyle();
			btn.addEventListener('click', () => {
				Zotero.Utilities.Internal.openPreferences('enterscholar-preferences');
			});
		container.appendChild(btn);
		wrapper.appendChild(container);
		append(wrapper);
		_widenSelectionPopup(wrapper);
		return;
		}
		
		let content = doc.createElement('div');
		container.appendChild(content);
		wrapper.appendChild(container);
		append(wrapper);
		_widenSelectionPopup(wrapper);
		
		if (autoTranslate) {
			content.textContent = '翻译中…';
			content.style.color = 'var(--fill-secondary)';
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
		}
		else {
			content.textContent = text.trim();
			content.style.cssText = 'color: var(--fill-secondary); margin-bottom: 8px;';
			let btn = doc.createElement('button');
			btn.textContent = '翻译';
			btn.style.cssText = _buttonStyle();
			btn.addEventListener('click', () => {
				btn.remove();
				content.textContent = '翻译中…';
				content.style.cssText = 'color: var(--fill-secondary);';
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
			});
			container.appendChild(btn);
		}
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
			label: 'Translation of Enterscholar翻译',
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
					Services.prompt.alert(null, 'Translation of Enterscholar', result);
				}
				catch (e) {
					Zotero.logError(e);
					Services.prompt.alert(null, 'Translation of Enterscholar', _getUserFriendlyError(e.message));
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
									Services.prompt.alert(null, 'Translation of Enterscholar', _getUserFriendlyError(e.message));
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
									Services.prompt.alert(null, 'Translation of Enterscholar — 使用额度', msg);
								}
								else {
									Services.prompt.alert(null, 'Translation of Enterscholar', '暂时无法获取额度信息，请稍后再试');
								}
							}
							catch (e) {
								Zotero.logError(e);
								Services.prompt.alert(null, 'Translation of Enterscholar', _getUserFriendlyError(e.message));
							}
						},
					},
				],
			},
		],
	});
}

// ── Item pane translate section (right sidebar) ──

function _renderSectionBody(body, doc) {
	if (!body || !doc) return;
	const XHTML_NS = 'http://www.w3.org/1999/xhtml';
	function h(tag) { return doc.createElementNS(XHTML_NS, tag); }
	
	try {
		let state = _sectionState;
		let autoOn = false;
		let currentLang = 'zh';
		let langLabel = '中文';
		try {
			autoOn = _getAutoTranslate();
			currentLang = Zotero.EnterScholar?.Config?.getTargetLanguage() || 'zh';
			langLabel = LANGUAGES.find(l => l.value === currentLang)?.label || currentLang;
		}
		catch (e) {
			Zotero.warn('[EnterScholar] _renderSectionBody config read error: ' + e);
		}
		
		while (body.firstChild) body.firstChild.remove();
		
		let root = h('div');
		root.style.cssText = 'padding:6px 10px;background:rgba(255,0,0,0.15);border:2px solid red;min-height:40px;';
		
		let statusBar = h('div');
		statusBar.style.cssText = 'font-size:12px;color:var(--fill-secondary);margin-bottom:6px;display:flex;gap:12px;';
		let autoLabel = h('span');
		autoLabel.textContent = `划词自动翻译: ${autoOn ? '开' : '关'}`;
		let langLabelEl = h('span');
		langLabelEl.textContent = `目标语言: ${langLabel}`;
		statusBar.append(autoLabel, langLabelEl);
		root.append(statusBar);
		
		if (!state.original) {
			let hint = h('div');
			hint.textContent = '在阅读器中选中文本即可翻译';
			hint.style.cssText = 'font-size:13px;color:var(--fill-tertiary);line-height:1.6;padding:4px 0;';
			root.append(hint);
		}
		else {
			let origLabel = h('div');
			origLabel.textContent = '【原文】';
			origLabel.style.cssText = 'font-size:11px;font-weight:600;color:var(--fill-secondary);margin-top:4px;';
			root.append(origLabel);
			
			let origText = h('div');
			origText.setAttribute('data-es-role', 'original');
			origText.textContent = state.original;
			origText.style.cssText = 'font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;user-select:text;margin-bottom:8px;';
			root.append(origText);
			
			let transLabel = h('div');
			transLabel.textContent = '【译文】';
			transLabel.style.cssText = 'font-size:11px;font-weight:600;color:var(--fill-secondary);';
			root.append(transLabel);
			
			let transText = h('div');
			transText.setAttribute('data-es-role', 'translation');
			transText.style.cssText = 'font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;user-select:text;padding:4px 0;';
			if (state.error) {
				transText.textContent = state.error;
				transText.style.color = 'var(--accent-red)';
			}
			else if (state.translated) {
				transText.textContent = state.translated;
			}
			else if (state.autoTriggered) {
				transText.textContent = '翻译中…';
				transText.style.color = 'var(--fill-secondary)';
			}
			else {
				transText.textContent = '选中文本后点击翻译按钮';
				transText.style.color = 'var(--fill-tertiary)';
			}
			root.append(transText);
		}
		
		root.setAttribute('data-es-rendered', '1');
		body.append(root);
		Zotero.warn('[ES] _renderSectionBody done: root.children=' + root.childNodes.length
			+ ', body.isConnected=' + body.isConnected
			+ ', body.offsetHeight=' + body.offsetHeight);
	}
	catch (e) {
		Zotero.logError('[EnterScholar] _renderSectionBody error: ' + e);
	}
}

function _findConnectedBody(hookBody) {
	if (hookBody && hookBody.isConnected) return hookBody;
	for (let inst of _sectionInstances) {
		if (inst.body && inst.body.isConnected) return inst.body;
	}
	return null;
}

function _refreshAllSections() {
	for (let inst of _sectionInstances) {
		if (inst.refresh) {
			try { inst.refresh(); }
			catch (e) {}
		}
	}
}

var ICON_HEADER = "data:image/svg+xml," + encodeURIComponent('<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5.5" cy="10.5" r="2.8" stroke="context-stroke" stroke-width="1.3"/><circle cx="11" cy="11" r="2.4" stroke="context-stroke" stroke-width="1.3"/><path d="M7.2 8.2C6.8 5.8 7.6 3.8 8.5 2.5" stroke="context-stroke" stroke-width="1.2" stroke-linecap="round"/><path d="M9.2 9C9.6 6.5 9.2 4.5 8.5 2.5" stroke="context-stroke" stroke-width="1.2" stroke-linecap="round"/><path d="M8.5 2.5C9.8 1.7 11.5 1.8 12.2 2.7" stroke="context-stroke" stroke-width="1.2" stroke-linecap="round"/></svg>');
var ICON_SIDENAV = "data:image/svg+xml," + encodeURIComponent('<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="13" r="3.2" stroke="context-stroke" stroke-width="1.4"/><circle cx="13.5" cy="13.5" r="2.8" stroke="context-stroke" stroke-width="1.4"/><path d="M9 10.5C8.5 7 9.5 4.5 10.5 3" stroke="context-stroke" stroke-width="1.3" stroke-linecap="round"/><path d="M11.5 11C12 8 11.5 5.5 10.5 3" stroke="context-stroke" stroke-width="1.3" stroke-linecap="round"/><path d="M10.5 3C12 2 14 2.2 15 3.2" stroke="context-stroke" stroke-width="1.3" stroke-linecap="round"/></svg>');

function _registerTranslateSection() {
	if (!Zotero.ItemPaneManager) {
		Zotero.warn('[EnterScholar] ItemPaneManager not available');
		return;
	}
	
	let result = Zotero.ItemPaneManager.registerSection({
		paneID: 'enterscholar-translate',
		pluginID: PLUGIN_ID,
		header: {
			l10nID: 'enterscholar-section-header',
			icon: ICON_HEADER,
		},
		sidenav: {
			l10nID: 'enterscholar-section-sidenav',
			icon: ICON_SIDENAV,
		},
		bodyXHTML: '',
		sectionButtons: [
			{
				type: 'translate',
				icon: 'chrome://zotero/skin/16/universal/sync.svg',
				l10nID: 'enterscholar-section-translate',
				onClick: ({ body }) => {
					if (!_sectionState.original) return;
					_sectionState.translated = '';
					_sectionState.error = '';
					_sectionState.loading = true;
					_sectionState.autoTriggered = true;
					_refreshAllSections();
				},
			},
			{
				type: 'copy',
				icon: 'chrome://zotero/skin/16/universal/copy.svg',
				l10nID: 'enterscholar-section-copy',
				onClick: ({ body }) => {
					let actualBody = _findConnectedBody(body);
					let transEl = actualBody?.querySelector('[data-es-role="translation"]');
					let text = transEl?.textContent;
					if (text && text !== '翻译中…' && text !== '选中文本后点击翻译按钮') {
						let clipboard = Cc['@mozilla.org/widget/clipboardhelper;1']
							.getService(Ci.nsIClipboardHelper);
						clipboard.copyString(text);
					}
				},
			},
		],
	onInit: ({ body, refresh }) => {
		let section = body?.closest('collapsible-section');
		let details = body?.closest('item-details');
		Zotero.warn('[ES] onInit: body=' + !!body
			+ ', section.open=' + section?.hasAttribute('open')
			+ ', section.empty=' + section?.hasAttribute('empty')
			+ ', details.id=' + details?.id);
		_sectionInstances.push({ body, refresh });
		_renderSectionBody(body, body?.ownerDocument);
		Zotero.warn('[ES] onInit: after render, body.childNodes=' + body?.childNodes?.length
			+ ', body.innerHTML.length=' + body?.innerHTML?.length);
	},
	onDestroy: ({ body }) => {
		Zotero.warn('[ES] onDestroy');
		_sectionInstances = _sectionInstances.filter(inst => inst.body !== body);
	},
	onItemChange: ({ item, setEnabled }) => {
		Zotero.warn('[ES] onItemChange: item=' + item?.id + ', title=' + item?.getField?.('title')?.substring(0, 30));
		setEnabled(true);
	},
	onRender: ({ body, item }) => {
		let section = body?.closest('collapsible-section');
		let parent = body?.closest('item-pane-custom-section');
		Zotero.warn('[ES] onRender: body=' + !!body
			+ ', item=' + item?.id
			+ ', section.open=' + section?.hasAttribute('open')
			+ ', section.empty=' + section?.hasAttribute('empty')
			+ ', parent.hidden=' + parent?.hidden);
		_renderSectionBody(body, body?.ownerDocument);
		Zotero.warn('[ES] onRender: after render, body.childNodes=' + body?.childNodes?.length
			+ ', body.scrollHeight=' + body?.scrollHeight);
	},
		onAsyncRender: async ({ body, item }) => {
			let state = _sectionState;
			if (!state.original || state.translated || state.error || !state.autoTriggered) return;
			
			let actualBody = _findConnectedBody(body);
			if (!actualBody) return;
			
			let transBox = actualBody.querySelector('[data-es-role="translation"]');
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
						let tb = actualBody.querySelector('[data-es-role="translation"]');
						if (tb) {
							tb.textContent = partial || '翻译中…';
							if (done) {
								tb.style.color = 'var(--fill-primary)';
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
				let tb = actualBody.querySelector('[data-es-role="translation"]');
				if (tb) {
					tb.textContent = state.error;
					tb.style.color = 'var(--accent-red)';
				}
			}
		},
	});
	if (result) {
		try {
			Zotero.Prefs.set(`panes.${result}.open`, true);
		}
		catch (e) {}
		setTimeout(() => {
			try {
				Zotero.Notifier.trigger('refresh', 'itempane', [], {});
			}
			catch (e) {}
		}, 500);
	}
}

function _updateTranslateSection(text, autoTranslate) {
	if (!text) return;
	_sectionState = {
		original: text,
		translated: '',
		loading: autoTranslate,
		error: '',
		autoTriggered: autoTranslate,
	};
	_refreshAllSections();
}

// ── Helpers ──

function _escapeHTML(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _buttonStyle() {
	return [
		'padding: 4px 16px',
		'border: 1px solid var(--fill-quinary)',
		'border-radius: 6px',
		'background: var(--material-background, transparent)',
		'color: var(--fill-primary)',
		'font-size: 12px',
		'cursor: pointer',
	].join(';');
}

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
