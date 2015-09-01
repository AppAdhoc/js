// Note window.adhoc contains the API.
// Only 5 calls are public to user app:
//   init(adhoc_app_track_id, client_id)
//   getCachedExperimentFlags()
//   getExperimentFlags(callback, callbackOnCache)
//   incrementStat(stat, value)
//   forceExperiment(qr_code)
//
(function(adhoc, document, window, undefined) {
	'use strict';

	var protocol = window.location.protocol === "https:" ? "https:" : "http:";
	var ADHOC_GETFLAGS_URL = protocol + '//experiment.appadhoc.com/get_flags';
	var ADHOC_FORCEEXP_URL = protocol + '//api.appadhoc.com/optimizer/api/forceexp.php';
	var ADHOC_TRACKING_PORT = protocol === 'https:' ? '23463' : '23462';
	var ADHOC_TRACKING_URL = protocol + '//tracking.appadhoc.com:' + ADHOC_TRACKING_PORT;

	// Canonicalize Date.now().
	Date.now = Date.now || function() {
	 	return new Date().getTime();
	};

	// Canonicalize JSON.stringify().
	JSON.stringify = JSON.stringify || function(obj) {
		var t = typeof (obj);
		if (t != "object" || obj === null) {
			if (t == "string") obj = '"'+obj+'"';
			return String(obj);
		} else {
			var n, v, json = [], arr = (obj && obj.constructor == Array);
			for (n in obj) {
				v = obj[n];
				t = typeof(v);
				if (t == "string") v = '"'+v+'"';
				else if (t == "object" && v !== null) v = JSON.stringify(v);
				json.push((arr ? "" : '"' + n + '":') + String(v));
			}
			return (arr ? "[" : "{") + String(json) + (arr ? "]" : "}");
		}
	};

	// Canonicalize JSON.parse().
	JSON.parse = JSON.parse || function(str) {
		return eval("(" + str + ")");
	};

	var getCookie = function(cname) {
		var name = cname + "=";
		var ca = document.cookie.split(';');
		for(var i = 0; i < ca.length; i++) {
			var c = ca[i];
			while(c.charAt(0) == ' ') c = c.substring(1);
			if(c.indexOf(cname) === 0) return c.substring(name.length, c.length);
		}
		return null;
	};

	var setCookie = function(cname, value, days) {
		var expires = "";
	  if (days) {
	    var date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
	    var expires = "; expires=" + date.toUTCString();
	  }
		var toset = cname + "=" + value + expires + "; path=/";
		document.cookie = toset;
	};

	var getCachedFlags = function() {
		//TODO: if possible, compress all flags into one cookie.
		// var flags = getCookie("ADHOC_FLAGS") || "{}";
		// return JSON.parse(decodeURIComponent(flags));
		var flags = {};
		var ca = document.cookie.split(';');
		for(var i = 0; i < ca.length; i++) {
			var c = ca[i];
			while(c.charAt(0) == ' ') c = c.substring(1);
			if(c.indexOf('ADHOC_FLAG_') == 0) {
				//TODO: correctly handle string / boolean flags.
				var flag = c.substring(11, c.indexOf('='));
				var value = c.substring(c.indexOf('=') + 1, c.length);
				if (value === "false") {
					value = false;
				} else if (value === "true") {
					value = true;
				} else if (Number(value) != "NaN") {
					value = Number(value);
				}
				flags[flag] = value;
			}
		}
		return flags;
	};

	// Micro implementaiton of AJAX.
	var AJAX = function(url, data, callback) {
		url = url || '';
		data = data || {};

		var x = new XMLHttpRequest();
		if (callback != null) {
			x.onload = function() {
				var json = JSON.parse(this.responseText);
				// Cache response data, mostly for flags.
				//TODO: if possible, compress the entire JSON obj into one cookie.
				//setCookie("ADHOC_FLAGS", encodeURIComponent(JSON.stringify(json)), 365);
				for (var k in json) {
					setCookie("ADHOC_FLAG_" + k, json[k], 365);
				}
				callback(json);
			};
		}
		x.open("POST", url);
		x.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		x.send(JSON.stringify(data));
	};

	var getBrowserInfo = function() {
		var ua = window.navigator.userAgent, tem, M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
		if(/trident/i.test(M[1])) {
			tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
			return {
				n: 'IE',
				v: (tem[1] || '')
			};
		}
		if(M[1] === 'Chrome'){
			tem = ua.match(/\bOPR\/(\d+)/)
			if(tem != null) {
				return {
					n: 'Opera',
					v: tem[1]
				};
			}
		}
		M = M[2] ? [M[1], M[2]] : [window.navigator.appName, window.navigator.appVersion, '-?'];
		if((tem = ua.match(/version\/(\d+)/i)) != null) M.splice(1,1,tem[1]);
		return {
			n: M[0],  // n as name
			v: M[1]   // v as version
		};
	};

	var thisAdhoc = adhoc;

    thisAdhoc.customs = {};

	thisAdhoc.generateClientId = function() {
		function s4() {
			return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
		}
		return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
	};

	thisAdhoc.init = function(appKey, clientId) {
		thisAdhoc.ak = appKey;  // ak as appKey

		// If App specifies client id, use it. Otherwise, use cookie for id.
		var cookieClientId = getCookie('ADHOC_MEMBERSHIP_CLIENT_ID');
		if (cookieClientId == null) {
			cookieClientId = thisAdhoc.generateClientId();
			setCookie('ADHOC_MEMBERSHIP_CLIENT_ID', cookieClientId, 365);
		}
		thisAdhoc.c = clientId || cookieClientId;  // c as clientId
		thisAdhoc.c = String(thisAdhoc.c);
	}

	thisAdhoc.getCachedExperimentFlags = function() {
		return getCachedFlags();
	}

	thisAdhoc.getExperimentFlags = function(callback, callbackOnCache) {
	 	callback = callback || function(){};
	 	if(callbackOnCache && typeof(callbackOnCache) == 'function') {
			callbackOnCache(getCachedFlags());
		}

		var b = getBrowserInfo();
		var data = {
			app_key: thisAdhoc.ak,
			summary: {
				OS: b.n,
				OS_version: b.v,
				url: window.location.href,
				referrer: document.referrer,
				language: window.navigator.language,
				device_os_name: window.navigator.platform,
				height: window.innerHeight,
				width: window.innerWidth
			},
			custom: thisAdhoc.customs
		};
		// Note for a new client, we may not have client_id yet, so we query the server to get one.
		if(thisAdhoc.c != null) {
			data.client_id = thisAdhoc.c;
		}

		AJAX(ADHOC_GETFLAGS_URL, data, callback);
	};

	thisAdhoc.incrementStat = function(stat, value) {
		var b = getBrowserInfo();
		var data = {
			adhoc_app_track_id: thisAdhoc.ak,
			client_id: thisAdhoc.c,
			event_type: 'REPORT_STAT',
			timestamp: Math.round(Date.now() / 1000),
			summary: {
				OS: b.n,
				OS_version: b.v,
				url: window.location.href,
				referrer: document.referrer,
				language: window.navigator.language,
				device_os_name: window.navigator.platform,
				height: window.innerHeight,
				width: window.innerWidth
			},
			stat_key: stat,
			stat_value: value
		};

		AJAX(ADHOC_TRACKING_URL, data, null);
	};

	thisAdhoc.forceExperiment = function(qr_code) {
		var data = {
			client_id: thisAdhoc.c,
			qr_code: qr_code
		};

		AJAX(ADHOC_FORCEEXP_URL, data, null);
	};

    thisAdhoc.setProperties = function(opts){
	   thisAdhoc.customs = opts;
    };

}((window.adhoc = typeof Object.create !== 'undefined' ? Object.create(null) : {}), document, window));
