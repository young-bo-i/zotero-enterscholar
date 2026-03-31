/* global Zotero, XMLHttpRequest */

if (typeof Zotero.EnterScholar === 'undefined') {
	Zotero.EnterScholar = {};
}

Zotero.EnterScholar.Translate = {
	_cache: new Map(),
	_inflight: new Map(),
	MAX_CACHE_SIZE: 200,
	
	LANGUAGE_NAMES: {
		'zh-CN': 'Simplified Chinese',
		'zh-TW': 'Traditional Chinese',
		'en': 'English',
		'ja': 'Japanese',
		'ko': 'Korean',
		'fr': 'French',
		'de': 'German',
		'es': 'Spanish',
		'ru': 'Russian',
		'pt': 'Portuguese',
		'ar': 'Arabic',
	},
	
	getDefaultSystemPrompt(targetLanguage) {
		let langName = this.LANGUAGE_NAMES[targetLanguage] || targetLanguage;
		return `You are a professional academic translator. `
			+ `Translate the following text into ${langName}. `
			+ `Maintain accuracy of academic and technical terminology. `
			+ `Output ONLY the translated text without any explanations, notes, or original text.`;
	},
	
	_buildMessages(text, config) {
		let customPrompt = Zotero.EnterScholar.Config.getSystemPrompt();
		let systemPrompt = customPrompt || this.getDefaultSystemPrompt(config.target_language);
		return [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: text },
		];
	},
	
	_getCacheKey(text, targetLanguage) {
		let trimmed = text.trim();
		let hash = Zotero.Utilities.Internal.md5(trimmed);
		return `${targetLanguage}:${hash}`;
	},
	
	_addToCache(key, value) {
		if (this._cache.size >= this.MAX_CACHE_SIZE) {
			let firstKey = this._cache.keys().next().value;
			this._cache.delete(firstKey);
		}
		this._cache.set(key, value);
	},
	
	/**
	 * @param {string} text
	 * @param {function} [onChunk] - Streaming callback: onChunk(partialText, done)
	 * @returns {Promise<string>}
	 */
	async translate(text, onChunk) {
		if (!text || !text.trim()) {
			throw new Error('请先选中需要翻译的文本');
		}
		
		let config = Zotero.EnterScholar.Config.getActiveConfig();
		if (!config) {
			throw new Error('尚未配置翻译服务，请前往设置登录账号或配置本地模型');
		}
		
		let cacheKey = this._getCacheKey(text, config.target_language);
		if (this._cache.has(cacheKey)) {
			let cached = this._cache.get(cacheKey);
			if (onChunk) onChunk(cached, true);
			return cached;
		}
		
		if (this._inflight.has(cacheKey)) {
			let result = await this._inflight.get(cacheKey);
			if (onChunk) onChunk(result, true);
			return result;
		}
		
		let useStream = !!onChunk && Zotero.EnterScholar.Config.getUseStream();
		
		let promise = (async () => {
			let result;
			if (useStream) {
				result = await this._streamRequest(text, config, onChunk);
			}
			else {
				result = await this._nonStreamRequest(text, config);
				if (onChunk) onChunk(result, true);
			}
			this._addToCache(cacheKey, result);
			return result;
		})();
		
		this._inflight.set(cacheKey, promise);
		try {
			return await promise;
		}
		finally {
			this._inflight.delete(cacheKey);
		}
	},
	
	_buildRequestHeaders(config) {
		let headers = { 'Content-Type': 'application/json' };
		
		if (config.mode === 'forum') {
			headers['User-Api-Key'] = config.api_key;
			headers['User-Api-Client-Id'] = Zotero.EnterScholar.Auth.clientId;
		}
		else {
			let provider = (config.provider || '').toLowerCase();
			if (provider === 'azure') {
				headers['api-key'] = config.api_key;
			}
			else {
				headers['Authorization'] = `Bearer ${config.api_key}`;
			}
		}
		
		return headers;
	},
	
	_buildRequestBody(text, config, stream) {
		let body = {
			messages: this._buildMessages(text, config),
		};
		
		if (stream) {
			body.stream = true;
		}
		
		if (config.mode === 'local' && config.model) {
			body.model = config.model;
		}
		if (config.max_tokens) {
			body.max_tokens = config.max_tokens;
		}
		
		return body;
	},
	
	async _nonStreamRequest(text, config) {
		let headers = this._buildRequestHeaders(config);
		let body = this._buildRequestBody(text, config, false);
		
		Zotero.debug(`EnterScholar: Non-stream request to ${config.endpoint}`);
		
		let response;
		try {
			response = await Zotero.HTTP.request('POST', config.endpoint, {
				headers,
				body: JSON.stringify(body),
				timeout: 60000,
				responseType: 'text',
			});
		}
		catch (e) {
			this._handleHTTPError(e);
		}
		
		return this._parseNonStreamResponse(response.responseText);
	},
	
	_parseNonStreamResponse(responseText) {
		let data;
		try {
			data = JSON.parse(responseText);
		}
		catch (e) {
			throw new Error('翻译服务返回了无法识别的内容，请稍后重试');
		}
		
		if (data.choices && data.choices.length > 0) {
			return data.choices[0].message?.content || data.choices[0].text || '';
		}
		if (data.content && Array.isArray(data.content)) {
			return data.content.filter(c => c.type === 'text').map(c => c.text).join('');
		}
		if (data.candidates && data.candidates.length > 0) {
			let parts = data.candidates[0].content?.parts;
			if (parts) return parts.map(p => p.text).join('');
		}
		
		throw new Error('翻译服务返回了不支持的格式，请检查服务配置');
	},
	
	_streamRequest(text, config, onChunk) {
		return new Promise((resolve, reject) => {
			let headers = this._buildRequestHeaders(config);
			let body = this._buildRequestBody(text, config, true);
			
			Zotero.debug(`EnterScholar: Stream request to ${config.endpoint}`);
			
			let xhr = new XMLHttpRequest();
			
			xhr.open('POST', config.endpoint, true);
			
			for (let [key, value] of Object.entries(headers)) {
				xhr.setRequestHeader(key, value);
			}
			
			let fullText = '';
			let lastProcessedIndex = 0;
			let lineBuffer = '';
			
			xhr.onprogress = function () {
				let newData = xhr.responseText.substring(lastProcessedIndex);
				lastProcessedIndex = xhr.responseText.length;
				
				lineBuffer += newData;
				let lines = lineBuffer.split('\n');
				lineBuffer = lines.pop();
				
				for (let line of lines) {
					line = line.trim();
					if (!line || !line.startsWith('data: ')) continue;
					
					let payload = line.substring(6);
					if (payload === '[DONE]') continue;
					
					try {
						let chunk = JSON.parse(payload);
						let content = chunk.choices?.[0]?.delta?.content;
						if (content) {
							fullText += content;
							onChunk(fullText, false);
						}
					}
					catch (e) {
						// Partial JSON, skip
					}
				}
			};
			
		xhr.onloadend = function () {
			if (xhr.status >= 200 && xhr.status < 300) {
				onChunk(fullText, true);
				resolve(fullText);
			}
			else if (xhr.status === 401 || xhr.status === 403) {
				reject(new Error('登录已过期或权限不足，请重新登录后再试'));
			}
			else if (xhr.status === 404) {
				reject(new Error('翻译服务暂不可用，请检查设置或联系管理员'));
			}
			else if (xhr.status === 429) {
				let quotaMsg = '';
				try {
					let errData = JSON.parse(xhr.responseText);
					if (errData.daily_quota !== undefined) {
						quotaMsg = `今日翻译配额已用完（已用 ${errData.used_today || 0}/${errData.daily_quota}），`
							+ '前往 Enterscholar 申请更多配额：https://enterscholar.com/';
					}
				}
				catch (_) {}
				reject(new Error(quotaMsg || '请求过于频繁，请稍后再试'));
			}
			else if (xhr.status >= 500) {
				reject(new Error('翻译服务暂时出现问题，请稍后重试'));
			}
			else {
				let errorMsg = '';
				try {
					let errData = JSON.parse(xhr.responseText);
					errorMsg = errData.error || errData.message || '';
				}
				catch (_) {}
				reject(new Error(errorMsg || '翻译失败，请稍后重试'));
			}
		};
		
		xhr.onerror = function () {
			reject(new Error('无法连接翻译服务，请检查网络连接'));
		};
		
		xhr.ontimeout = function () {
			reject(new Error('翻译服务响应超时，请稍后重试'));
		};
			
			xhr.timeout = 120000;
			xhr.send(JSON.stringify(body));
		});
	},
	
	_handleHTTPError(e) {
		if (e.status === 401 || e.status === 403) {
			throw new Error('登录已过期或权限不足，请重新登录后再试');
		}
		if (e.status === 404) {
			throw new Error('翻译服务暂不可用，请检查设置或联系管理员');
		}
		if (e.status === 429) {
			let quotaMsg = '';
			try {
				let errData = JSON.parse(e.responseText);
				if (errData.daily_quota !== undefined) {
					quotaMsg = `今日翻译配额已用完（已用 ${errData.used_today || 0}/${errData.daily_quota}），`
						+ '前往 Enterscholar 申请更多配额：https://enterscholar.com/';
				}
			}
			catch (_) {}
			throw new Error(quotaMsg || '请求过于频繁，请稍后再试');
		}
		if (e.status >= 500) {
			throw new Error('翻译服务暂时出现问题，请稍后重试');
		}
		if (e.status) {
			let errorMsg = '';
			try {
				let errBody = JSON.parse(e.responseText);
				errorMsg = errBody.error || errBody.message || '';
			}
			catch (_) {}
			throw new Error(errorMsg || '翻译失败，请稍后重试');
		}
		throw new Error('无法连接翻译服务，请检查网络连接');
	},
	
	clearCache() {
		this._cache.clear();
		this._inflight.clear();
	},
};
