/* global Zotero, document, Services, MozXULElement */

MozXULElement.insertFTLIfNeeded('enterscholar.ftl');

Zotero.EnterScholar.Preferences = {
	_advancedVisible: false,
	
	init() {
		this.updateAccountUI();
		this.onConfigSourceChange();
		if (Zotero.EnterScholar.Auth.isLoggedIn) {
			this.checkUsage();
		}
	},
	
	updateAccountUI() {
		let isLoggedIn = Zotero.EnterScholar.Auth.isLoggedIn;
		let username = Zotero.EnterScholar.Auth.username;
		
		let notLoggedIn = document.getElementById('enterscholar-not-logged-in');
		let loggedIn = document.getElementById('enterscholar-logged-in');
		let usernameLabel = document.getElementById('enterscholar-username-label');
		
		if (isLoggedIn) {
			notLoggedIn.hidden = true;
			loggedIn.hidden = false;
			usernameLabel.value = `已登录：${username || '用户'}`;
		}
		else {
			notLoggedIn.hidden = false;
			loggedIn.hidden = true;
		}
	},
	
	toggleAdvanced() {
		this._advancedVisible = !this._advancedVisible;
		let section = document.getElementById('enterscholar-advanced-section');
		let toggle = document.getElementById('enterscholar-advanced-toggle');
		
		section.hidden = !this._advancedVisible;
		
		if (this._advancedVisible) {
			toggle.dataset.l10nId = 'enterscholar-hide-advanced';
		}
		else {
			toggle.dataset.l10nId = 'enterscholar-show-advanced';
		}
	},
	
	async login() {
		let loginBtn = document.getElementById('enterscholar-login-btn');
		loginBtn.disabled = true;
		
		try {
			await Zotero.EnterScholar.Auth.login();
			this.updateAccountUI();
			Zotero.EnterScholar.Config.clearCache();
		}
		catch (e) {
			Zotero.logError(e);
			if (e.message !== '登录已取消') {
				Services.prompt.alert(null, 'Translation of Enterscholar', e.message);
			}
		}
		finally {
			loginBtn.disabled = false;
		}
	},
	
	async logout() {
		await Zotero.EnterScholar.Auth.logout();
		Zotero.EnterScholar.Config.clearCache();
		Zotero.EnterScholar.Translate.clearCache();
		this.updateAccountUI();
		
		let usageBox = document.getElementById('enterscholar-usage-box');
		usageBox.hidden = true;
	},
	
	async checkUsage() {
		let btn = document.getElementById('enterscholar-check-usage-btn');
		btn.disabled = true;
		
		let usageBox = document.getElementById('enterscholar-usage-box');
		let usageLabel = document.getElementById('enterscholar-usage-label');
		let exhaustedBox = document.getElementById('enterscholar-quota-exhausted-box');
		
		try {
			let usage = await Zotero.EnterScholar.Config.fetchUsage(true);
			
			let parts = [];
			let exhausted = false;
			if (usage.daily_quota !== undefined) {
				let usedToday = usage.used_today || 0;
				let remaining = usage.remaining ?? (usage.daily_quota - usedToday);
				parts.push(`今日已用 ${usedToday} / ${usage.daily_quota}`);
				parts.push(`剩余 ${remaining}`);
				exhausted = usage.daily_quota > 0 && remaining <= 0;
			}
			if (usage.trust_level !== undefined) {
				parts.push(`TL${usage.trust_level}`);
			}
			if (parts.length === 0) {
				parts.push('已获取额度信息');
			}
			usageLabel.value = parts.join('  ·  ');
			usageBox.hidden = false;
			if (exhaustedBox) {
				exhaustedBox.hidden = !exhausted;
			}
		}
		catch (e) {
			Zotero.logError(e);
			usageLabel.value = e.message || '暂时无法获取额度信息';
			usageBox.hidden = false;
			if (exhaustedBox) {
				exhaustedBox.hidden = true;
			}
		}
		finally {
			btn.disabled = false;
		}
	},
	
	onConfigSourceChange() {
		let sourceElem = document.getElementById('enterscholar-config-source');
		if (!sourceElem) return;
		let source = sourceElem.value;
		let localGroup = document.getElementById('enterscholar-local-config-group');
		if (!localGroup) return;
		
		if (source === 'forum') {
			localGroup.style.opacity = '0.5';
			localGroup.style.pointerEvents = 'none';
		}
		else {
			localGroup.style.opacity = '';
			localGroup.style.pointerEvents = '';
		}
	},
};
