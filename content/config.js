/* global Zotero */

if (typeof Zotero.EnterScholar === 'undefined') {
	Zotero.EnterScholar = {};
}

Zotero.EnterScholar.Config = {
	_cachedUsage: null,
	_usageCacheTimestamp: 0,
	USAGE_CACHE_TTL: 60 * 1000,
	
	async init() {
		Zotero.debug('EnterScholar: Config module initialized');
	},
	
	getForumURL() {
		return Zotero.Prefs.get('extensions.enterscholar.forumURL', true) || 'http://localhost';
	},
	
	getBridgeURL() {
		let base = this.getForumURL();
		let endpoint = Zotero.Prefs.get('extensions.enterscholar.bridgeEndpoint', true)
			|| '/zotero-bridge/v1/chat/completions';
		return base + endpoint;
	},
	
	getUsageURL() {
		let base = this.getForumURL();
		let endpoint = Zotero.Prefs.get('extensions.enterscholar.usageEndpoint', true)
			|| '/zotero-bridge/usage';
		return base + endpoint;
	},
	
	getConfigSource() {
		return Zotero.Prefs.get('extensions.enterscholar.configSource', true) || 'forum_first';
	},
	
	getTargetLanguage() {
		return Zotero.Prefs.get('extensions.enterscholar.targetLanguage', true) || 'zh-CN';
	},
	
	getMaxTokens() {
		return Zotero.Prefs.get('extensions.enterscholar.maxTokens', true) || 2000;
	},
	
	getSystemPrompt() {
		return Zotero.Prefs.get('extensions.enterscholar.systemPrompt', true) || '';
	},
	
	getUseStream() {
		return Zotero.Prefs.get('extensions.enterscholar.useStream', true);
	},
	
	getForumConfig() {
		let apiKey = Zotero.EnterScholar.Auth.userApiKey;
		if (!apiKey) {
			return null;
		}
		
		return {
			mode: 'forum',
			endpoint: this.getBridgeURL(),
			api_key: apiKey,
			target_language: this.getTargetLanguage(),
			max_tokens: this.getMaxTokens(),
		};
	},
	
	getLocalConfig() {
		let endpoint = Zotero.Prefs.get('extensions.enterscholar.local.endpoint', true) || '';
		let apiKey = Zotero.Prefs.get('extensions.enterscholar.local.apiKey', true) || '';
		let model = Zotero.Prefs.get('extensions.enterscholar.local.model', true) || '';
		let provider = Zotero.Prefs.get('extensions.enterscholar.local.provider', true) || '';
		
		if (!endpoint || !apiKey) {
			return null;
		}
		
		return {
			mode: 'local',
			provider,
			endpoint,
			api_key: apiKey,
			model,
			target_language: this.getTargetLanguage(),
			max_tokens: this.getMaxTokens(),
		};
	},
	
	getActiveConfig() {
		let source = this.getConfigSource();
		
		switch (source) {
			case 'local':
				return this.getLocalConfig();
			
			case 'forum':
				return this.getForumConfig();
			
			case 'forum_first':
			default: {
				let forumConfig = this.getForumConfig();
				if (forumConfig) {
					return forumConfig;
				}
				return this.getLocalConfig();
			}
		}
	},
	
	async fetchUsage(forceRefresh = false) {
		if (!forceRefresh
			&& this._cachedUsage
			&& (Date.now() - this._usageCacheTimestamp) < this.USAGE_CACHE_TTL) {
			return this._cachedUsage;
		}
		
		let apiKey = Zotero.EnterScholar.Auth.userApiKey;
		if (!apiKey) {
			throw new Error('未登录');
		}
		
		let url = this.getUsageURL();
		Zotero.debug('EnterScholar: Fetching usage from ' + url);
		
		let response = await Zotero.HTTP.request('GET', url, {
			headers: {
				'User-Api-Key': apiKey,
				'User-Api-Client-Id': Zotero.EnterScholar.Auth.clientId,
			},
			timeout: 10000,
		});
		
		Zotero.debug('EnterScholar: Usage response status: ' + response.status);
		Zotero.debug('EnterScholar: Usage response: ' + response.responseText.substring(0, 500));
		
		let text = response.responseText;
		if (!text || !text.trim()) {
			throw new Error('响应为空 (HTTP ' + response.status + ')');
		}
		
		let usage;
		try {
			usage = JSON.parse(text);
		}
		catch (parseErr) {
			throw new Error('响应非JSON: ' + text.substring(0, 150));
		}
		
		this._cachedUsage = usage;
		this._usageCacheTimestamp = Date.now();
		return usage;
	},
	
	clearCache() {
		this._cachedUsage = null;
		this._usageCacheTimestamp = 0;
	},
};
