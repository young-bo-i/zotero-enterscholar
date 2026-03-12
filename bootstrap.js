var PLUGIN_ID;
var rootURI;

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

function _registerReaderPopup() {
	Zotero.Reader.registerEventListener('renderTextSelectionPopup', (event) => {
		if (!Zotero.Prefs.get('extensions.enterscholar.enableReaderPopup', true)) {
			return;
		}
		
		let { reader, doc, params, append } = event;
		let text = params.annotation?.text;
		if (!text || !text.trim()) return;
		
		let container = doc.createElement('div');
		container.style.cssText = [
			'padding: 10px 14px',
			'border-top: 1px solid var(--fill-quinary)',
			'font-size: 13px',
			'line-height: 1.6',
			'min-width: 360px',
			'max-width: 560px',
			'white-space: pre-wrap',
			'word-break: break-word',
		].join(';');
		
		let header = doc.createElement('div');
		header.style.cssText = [
			'font-weight: 600',
			'margin-bottom: 6px',
			'color: var(--fill-secondary)',
			'font-size: 11px',
			'text-transform: uppercase',
			'letter-spacing: 0.5px',
		].join(';');
		header.textContent = '恩特学术';
		container.appendChild(header);
		
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
			append(container);
			return;
		}
		
		let content = doc.createElement('div');
		content.textContent = '翻译中…';
		content.style.color = 'var(--fill-secondary)';
		container.appendChild(content);
		append(container);
		
		Zotero.EnterScholar.Translate.translate(text, (partial, done) => {
			content.textContent = partial || '翻译中…';
			if (done) {
				content.style.color = '';
			}
		}).catch((e) => {
			Zotero.logError(e);
			content.textContent = e.message;
			content.style.color = 'var(--accent-red)';
		});
	}, PLUGIN_ID);
}

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
					Services.prompt.alert(null, '恩特学术', '翻译失败: ' + e.message);
				}
			}
		});
	}, PLUGIN_ID);
}

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
								Services.prompt.alert(null, '恩特学术', '登录失败: ' + e.message);
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
									Services.prompt.alert(null, '恩特学术 - 配额', msg);
								}
								else {
									Services.prompt.alert(null, '恩特学术', '无法获取配额信息');
								}
							}
							catch (e) {
								Zotero.logError(e);
								Services.prompt.alert(null, '恩特学术', '查询失败: ' + e.message);
							}
						},
					},
				],
			},
		],
	});
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
