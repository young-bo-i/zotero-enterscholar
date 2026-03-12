/* global Zotero, XMLHttpRequest */

if (typeof Zotero.EnterScholar === 'undefined') {
	Zotero.EnterScholar = {};
}

Zotero.EnterScholar.Translate = {
	_cache: new Map(),
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
		let trimmed = text.trim().substring(0, 500);
		return `${targetLanguage}:${trimmed}`;
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
			throw new Error('No text to translate');
		}
		
		let config = Zotero.EnterScholar.Config.getActiveConfig();
		if (!config) {
			throw new Error('未配置翻译服务，请在设置中配置或登录恩特学术。');
		}
		
		let cacheKey = this._getCacheKey(text, config.target_language);
		if (this._cache.has(cacheKey)) {
			let cached = this._cache.get(cacheKey);
			if (onChunk) onChunk(cached, true);
			return cached;
		}
		
		let useStream = !!onChunk && Zotero.EnterScholar.Config.getUseStream();
		
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
			throw new Error('无法解析翻译响应');
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
		
		throw new Error('无法识别的翻译响应格式');
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
				else if (xhr.status === 403) {
					reject(new Error('权限不足（403）。如使用论坛翻译，请确认论坛已部署 bridge 插件并重新登录。'));
				}
				else if (xhr.status === 404) {
					reject(new Error('翻译端点不存在（404）。请检查论坛是否已部署 bridge 插件，或切换到本地大模型配置。'));
				}
				else {
					let errorMsg = '翻译请求失败';
					try {
						let errData = JSON.parse(xhr.responseText);
						errorMsg = errData.error || errData.message || errorMsg;
					}
					catch (_) {
						if (xhr.responseText) errorMsg += ': ' + xhr.responseText.substring(0, 200);
					}
					reject(new Error(`(${xhr.status}) ${errorMsg}`));
				}
			};
			
			xhr.onerror = function () {
				reject(new Error('网络错误，无法连接翻译服务'));
			};
			
			xhr.ontimeout = function () {
				reject(new Error('翻译请求超时'));
			};
			
			xhr.timeout = 120000;
			xhr.send(JSON.stringify(body));
		});
	},
	
	_handleHTTPError(e) {
		if (e.status === 403) {
			throw new Error('权限不足（403）。如使用论坛翻译，请确认论坛已部署 bridge 插件并重新登录。');
		}
		if (e.status === 404) {
			throw new Error('翻译端点不存在（404）。请检查论坛是否已部署 bridge 插件，或切换到本地大模型配置。');
		}
		if (e.status) {
			let errorMsg = '';
			try {
				let errBody = JSON.parse(e.responseText);
				errorMsg = errBody.error || errBody.message || e.responseText;
			}
			catch (_) {
				errorMsg = e.responseText || e.message;
			}
			throw new Error(`(${e.status}) ${errorMsg}`);
		}
		throw new Error('网络错误: ' + e.message);
	},
	
	clearCache() {
		this._cache.clear();
	},
};
