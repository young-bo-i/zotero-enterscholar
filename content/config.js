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
			throw new Error('请先登录恩特学术账号');
		}
		
		let url = this.getUsageURL();
		Zotero.debug('EnterScholar: Fetching usage from ' + url);
		
		let response;
		try {
			response = await Zotero.HTTP.request('GET', url, {
				headers: {
					'Accept': 'application/json',
					'User-Api-Key': apiKey,
					'User-Api-Client-Id': Zotero.EnterScholar.Auth.clientId,
				},
				timeout: 10000,
			});
		}
		catch (e) {
			Zotero.debug('EnterScholar: Usage request failed: ' + e.message);
			if (e.status === 401 || e.status === 403) {
				throw new Error('登录已过期，请重新登录');
			}
			if (e.status === 404) {
				throw new Error('配额服务暂未开放');
			}
			throw new Error('无法连接服务器，请检查网络');
		}
		
		Zotero.debug('EnterScholar: Usage response status: ' + response.status);
		
		let text = response.responseText;
		if (!text || !text.trim()) {
			throw new Error('服务器返回了空内容，请稍后重试');
		}
		
		let usage;
		try {
			usage = JSON.parse(text);
		}
		catch (parseErr) {
			Zotero.debug('EnterScholar: Usage parse error, raw: ' + text.substring(0, 200));
			throw new Error('服务器返回了无法识别的内容，请稍后重试');
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
