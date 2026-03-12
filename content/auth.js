/* global Zotero, Services, Cc, Ci, ChromeUtils, crypto */

if (typeof Zotero.EnterScholar === 'undefined') {
	Zotero.EnterScholar = {};
}

Zotero.EnterScholar.Auth = {
	APPLICATION_NAME: 'Zotero',
	SCOPES: 'read,write,discourse-zotero-bridge:zotero_bridge',
	AUTH_REDIRECT_PATH: '/zotero-auth-callback',
	
	_privateKeyObj: null,
	_lastNonce: null,
	
	get clientId() {
		let id = Zotero.Prefs.get('extensions.enterscholar.clientId', true);
		if (!id) {
			id = 'zotero_bridge_' + this._generateRandomId();
			Zotero.Prefs.set('extensions.enterscholar.clientId', id, true);
		}
		return id;
	},
	
	get forumURL() {
		return Zotero.EnterScholar.Config.getForumURL();
	},
	
	get authRedirectURL() {
		return this.forumURL + this.AUTH_REDIRECT_PATH;
	},
	
	get isLoggedIn() {
		return !!Zotero.Prefs.get('extensions.enterscholar.userApiKey', true);
	},
	
	get username() {
		return Zotero.Prefs.get('extensions.enterscholar.username', true) || '';
	},
	
	get userApiKey() {
		return Zotero.Prefs.get('extensions.enterscholar.userApiKey', true) || '';
	},
	
	_generateRandomId() {
		let array = new Uint8Array(12);
		crypto.getRandomValues(array);
		return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
	},
	
	_generateNonce() {
		let array = new Uint8Array(16);
		crypto.getRandomValues(array);
		return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
	},
	
	async generateRSAKeyPair() {
		let keyPair = await crypto.subtle.generateKey(
			{
				name: 'RSA-OAEP',
				modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]),
				hash: 'SHA-1',
			},
			true,
			['encrypt', 'decrypt']
		);
		
		let publicKeyData = await crypto.subtle.exportKey('spki', keyPair.publicKey);
		
		this._privateKeyObj = keyPair.privateKey;
		
		return {
			publicKeyPEM: this._arrayBufferToPEM(publicKeyData, 'PUBLIC KEY'),
		};
	},
	
	_arrayBufferToPEM(buffer, label) {
		let binary = '';
		let bytes = new Uint8Array(buffer);
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		let base64 = btoa(binary);
		let lines = [];
		for (let i = 0; i < base64.length; i += 64) {
			lines.push(base64.substring(i, i + 64));
		}
		return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
	},
	
	_base64Decode(str) {
		str = str.replace(/\s/g, '');
		str = str.replace(/-/g, '+').replace(/_/g, '/');
		let pad = str.length % 4;
		if (pad === 2) str += '==';
		else if (pad === 3) str += '=';
		return atob(str);
	},
	
	async decryptPayload(encryptedBase64) {
		if (!this._privateKeyObj) {
			throw new Error('No private key available for decryption');
		}
		
		let binary = this._base64Decode(encryptedBase64);
		let bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		
		let decrypted = await crypto.subtle.decrypt(
			{ name: 'RSA-OAEP' },
			this._privateKeyObj,
			bytes.buffer
		);
		return new TextDecoder().decode(decrypted);
	},
	
	buildAuthURL(publicKeyPEM) {
		let nonce = this._generateNonce();
		this._lastNonce = nonce;
		
		let params = new URLSearchParams({
			client_id: this.clientId,
			application_name: this.APPLICATION_NAME,
			scopes: this.SCOPES,
			nonce: nonce,
			public_key: publicKeyPEM,
			auth_redirect: this.authRedirectURL,
			padding: 'oaep',
		});
		
		return this.forumURL + '/user-api-key/new?' + params.toString();
	},
	
	async login() {
		Zotero.debug('EnterScholar: Starting login flow');
		
		let { publicKeyPEM } = await this.generateRSAKeyPair();
		let authURL = this.buildAuthURL(publicKeyPEM);
		
		Zotero.debug('EnterScholar: Opening auth window');
		
		return new Promise((resolve, reject) => {
			let authRedirectBase = this.authRedirectURL;
			let self = this;
			
			let ww = Cc['@mozilla.org/embedcomp/window-watcher;1']
				.getService(Ci.nsIWindowWatcher);
			
			let arg = {
				uri: authURL,
				options: {
					allowJavaScript: true,
				},
			};
			arg.wrappedJSObject = arg;
			
			let win = ww.openWindow(
				null,
				'chrome://zotero/content/standalone/basicViewer.xhtml',
				'enterscholar-auth',
				'chrome,dialog=yes,resizable,centerscreen,width=1000,height=700',
				arg
			);
			
			let startTime = Date.now();
			let handled = false;
			
			let cleanup = () => {
				let cookieManager = Cc["@mozilla.org/cookiemanager;1"]
					.getService(Ci.nsICookieManager);
				let sinceUs = startTime * 1000;
				let cookiesSince = cookieManager.getCookiesSince(sinceUs);
				Zotero.debug(`EnterScholar: Cleaning up ${cookiesSince.length} cookies from auth`);
				cookieManager.removeAllSince(sinceUs);
			};
			
			let tryExtractPayload = (browser) => {
				try {
					let currentURL = browser.webNavigation.currentURI.spec;
					if (currentURL.startsWith(authRedirectBase)) {
						Zotero.debug('EnterScholar: Detected auth redirect: ' + currentURL.substring(0, 80));
						return currentURL;
					}
				}
				catch (e) {
					// Browser may not be ready
				}
				return null;
			};
			
			let handleRedirect = (redirectURL) => {
				if (handled) return;
				handled = true;
				
				let url = new URL(redirectURL);
				let payload = url.searchParams.get('payload');
				
				if (payload) {
					self._handleAuthPayload(payload)
						.then((result) => {
							cleanup();
							win.close();
							resolve(result);
						})
						.catch((e) => {
							cleanup();
							win.close();
							reject(e);
						});
				}
				else {
					cleanup();
					win.close();
					reject(new Error('No payload in auth redirect'));
				}
			};
			
			win.addEventListener('load', () => {
				let browser = win.document.querySelector('browser');
				if (!browser) {
					reject(new Error('Could not find browser element'));
					return;
				}
				
				browser.addEventListener('pagetitlechanged', () => {
					let redirectURL = tryExtractPayload(browser);
					if (redirectURL) {
						handleRedirect(redirectURL);
					}
				});
				
				let checkInterval = setInterval(() => {
					let redirectURL = tryExtractPayload(browser);
					if (redirectURL) {
						clearInterval(checkInterval);
						handleRedirect(redirectURL);
					}
				}, 300);
				
				win.addEventListener('unload', () => {
					clearInterval(checkInterval);
					if (!handled) {
						cleanup();
						reject(new Error('Auth window closed by user'));
					}
				});
			});
		});
	},
	
	async _handleAuthPayload(payload) {
		try {
			let decryptedJSON = await this.decryptPayload(payload);
			let data = JSON.parse(decryptedJSON);
			
			Zotero.debug('EnterScholar: Auth payload decrypted successfully');
			
			if (this._lastNonce && data.nonce !== this._lastNonce) {
				throw new Error('Nonce mismatch -- possible replay attack');
			}
			
			let apiKey = data.key;
			if (!apiKey) {
				throw new Error('No API key in auth response');
			}
			
			Zotero.Prefs.set('extensions.enterscholar.userApiKey', apiKey, true);
			
			await this._fetchUsername(apiKey);
			
			return { success: true, apiKey };
		}
		catch (e) {
			Zotero.logError(e);
			throw new Error('Failed to process auth payload: ' + e.message);
		}
	},
	
	async _fetchUsername(apiKey) {
		try {
			let response = await Zotero.HTTP.request('GET', this.forumURL + '/session/current.json', {
				headers: {
					'Accept': 'application/json',
					'User-Api-Key': apiKey,
					'User-Api-Client-Id': this.clientId,
				},
				timeout: 10000,
			});
			
			let data = JSON.parse(response.responseText);
			let username = data.current_user?.username;
			if (username) {
				Zotero.Prefs.set('extensions.enterscholar.username', username, true);
				Zotero.debug('EnterScholar: Fetched username: ' + username);
				return;
			}
		}
		catch (e) {
			Zotero.debug('EnterScholar: Could not fetch username from session: ' + e.message);
		}
		
		try {
			let usageURL = Zotero.EnterScholar.Config.getUsageURL();
			let response = await Zotero.HTTP.request('GET', usageURL, {
				headers: {
					'Accept': 'application/json',
					'User-Api-Key': apiKey,
					'User-Api-Client-Id': this.clientId,
				},
				timeout: 10000,
			});
			
			let data = JSON.parse(response.responseText);
			if (data.username) {
				Zotero.Prefs.set('extensions.enterscholar.username', data.username, true);
			}
		}
		catch (e) {
			Zotero.debug('EnterScholar: Could not fetch username from usage: ' + e.message);
		}
	},
	
	async logout() {
		let apiKey = this.userApiKey;
		
		if (apiKey) {
			try {
				await Zotero.HTTP.request('POST', this.forumURL + '/user-api-key/revoke', {
					headers: {
						'User-Api-Key': apiKey,
						'User-Api-Client-Id': this.clientId,
					},
					timeout: 10000,
				});
				Zotero.debug('EnterScholar: API key revoked on server');
			}
			catch (e) {
				Zotero.debug('EnterScholar: Could not revoke API key: ' + e.message);
			}
		}
		
		Zotero.Prefs.set('extensions.enterscholar.userApiKey', '', true);
		Zotero.Prefs.set('extensions.enterscholar.username', '', true);
		this._privateKeyObj = null;
		this._lastNonce = null;
		
		Zotero.debug('EnterScholar: Logged out');
	},
};
