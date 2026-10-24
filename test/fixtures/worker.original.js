
const SOUNDCLOUD_URL = "https://soundcloud.com/";
const SOUNDCLOUD_API_URL = "https://api-v2.soundcloud.com/";
const SOUNDCLOUD_AUTH_URL = "https://api-auth.soundcloud.com/";

class SoundCloud {
    constructor() {
        this.clientId = null;
    }

    async init() {
        if (!await this.checkClientId()) {
            await this.setClientId();
        }
    }

    async searchMusic(query) {
        try {
            const musics = [];
            const params = new URLSearchParams({
                'q': query,
                'sc_a_id': '801c8a51-9227-40d9-9c11-ac16f6bca216',
                'variant_ids': '',
                'facet': 'genre',
                'user_id': '367935-565481-285242-514567',
                'client_id': await this.getClientId(),
                'limit': '20',
                'offset': '0',
                'linked_partitioning': '1',
                'app_version': '1667398191',
                'app_locale': 'en'
            });

            const response = await fetch(`${SOUNDCLOUD_API_URL}search/tracks?${params}`);
            const data = await response.json();
            const searchData = data.collection;

            for (const music of searchData) {
                if (music.kind === 'track' && music.streamable) {
                    musics.push({
                        'id': music.id,
                        "picture": (music.artwork_url || music.user.avatar_url).replace("large", "original"),
                        "name": music.title,
                        'release': music.created_at,
                        'genre': music.genre,
                        'duration': music.duration,
                        'soundcloudurl': music.permalink_url
                    });
                }
            }
            return musics;
        } catch (error) {
            return this.internalError();
        }
    }

    async getMusic(id, exportOriginal = false) {
        try {
            const params = new URLSearchParams({
                'ids': id,
                'client_id': await this.getClientId(),
                '%5Bobject%20Object%5D': '',
                'app_version': '1667398191',
                'app_locale': 'en'
            });

            const response = await fetch(`${SOUNDCLOUD_API_URL}tracks?${params}`);
            const data = await response.json();
            const musicData = data[0];

            if (!musicData) {
                return false;
            } else if (exportOriginal) {
                return musicData;
            } else {
                return {
                    'status': true,
                    'id': id,
                    'picture': (musicData.artwork_url || musicData.user.avatar_url).replace("large", "original"),
                    'title': musicData.title,
                    'release': musicData.created_at,
                    'genre': musicData.genre,
                    'duration': musicData.duration,
                    'soundcloudurl': musicData.permalink_url
                };
            }
        } catch (error) {
            return this.internalError();
        }
    }

    async getDownloadUrl(id) {
        try {
            const dataMusic = await this.getMusic(id, true);
            
            if (!dataMusic || !dataMusic.media || !dataMusic.media.transcodings) {
                return this.internalError();
            }

            const trackAuthorization = dataMusic.track_authorization;
            const transcoding = dataMusic.media.transcodings.find(t => 
                t.format && t.format.protocol === 'progressive'
            ) || dataMusic.media.transcodings[0];

            if (!transcoding) {
                return this.internalError();
            }

            const url = transcoding.url;
            const params = new URLSearchParams({
                'client_id': await this.getClientId(),
                'track_authorization': trackAuthorization
            });

            const response = await fetch(`${url}?${params}`);
            const data = await response.json();
            
            return {
                status: true,
                download_url: data.url,
                title: dataMusic.title,
                duration: dataMusic.duration,
                artwork: (dataMusic.artwork_url || dataMusic.user.avatar_url).replace("large", "original")
            };
        } catch (error) {
            return this.internalError();
        }
    }

    async getMusicWithUrl(url) {
        if (this.isValidSoundCloudUrl(url)) {
            const response = await fetch(url);
            const webPageContent = await response.text();
            
            const regex = /soundcloud:\/\/sounds:(.*?)"/gm;
            const matches = [...webPageContent.matchAll(regex)];
            
            if (matches.length > 0 && matches[0][1]) {
                return await this.getMusic(matches[0][1]);
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    async setClientId() {
        const response = await fetch(SOUNDCLOUD_URL);
        const pageData = await response.text();
        
        const assetRegex = /src=\"(https:\/\/a-v2\.sndcdn\.com\/assets\/[^.]+\.js)"/g;
        const assets = [...pageData.matchAll(assetRegex)];
        const assetUrl = assets[assets.length - 1][1];
        
        const assetResponse = await fetch(assetUrl);
        const assetContent = await assetResponse.text();
        
        const clientIdRegex = /[,|{]client_id:"([^"]+)"/g;
        const clientIds = [...assetContent.matchAll(clientIdRegex)];
        
        if (clientIds.length > 0) {
            const randomIndex = Math.floor(Math.random() * clientIds.length);
            this.clientId = clientIds[randomIndex][1];
            return this.clientId;
        }
        
        throw new Error("Could not find client ID");
    }

    async getClientId() {
        if (!this.clientId) {
            await this.setClientId();
        }
        return this.clientId;
    }

    async checkClientId() {
        try {
            const params = new URLSearchParams({
                'client_id': await this.getClientId()
            });
            
            const response = await fetch(`${SOUNDCLOUD_AUTH_URL}oauth/session?${params}`);
            const data = await response.json();
            
            return !!data.session;
        } catch (error) {
            return false;
        }
    }

    isValidSoundCloudUrl(url) {
        try {
            const urlObj = new URL(url);
            const soundcloudRegex = /^https?:\/\/(?:www\.)?(?:m\.)?soundcloud\.com\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+(?:\/)?/;
            return soundcloudRegex.test(url);
        } catch {
            return false;
        }
    }

    internalError() {
        return {
            'status': false,
            'status_det': "INTERNAL_ERROR"
        };
    }
}

export default {
    async fetch(request, env, ctx) {
        const soundcloud = new SoundCloud();
        await soundcloud.init();
        
        const url = new URL(request.url);
        const pathname = url.pathname;
        
        // CORS headers
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };
        
        // Handle OPTIONS request for CORS
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers });
        }
        
        // Routes
        if (pathname === '/search' && request.method === 'GET') {
            const query = url.searchParams.get('q');
            if (!query) {
                return new Response(JSON.stringify({ error: 'Query parameter "q" is required' }), {
                    status: 400,
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }
            
            const results = await soundcloud.searchMusic(query);
            return new Response(JSON.stringify(results), {
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }
        
        if (pathname === '/music' && request.method === 'GET') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Parameter "id" is required' }), {
                    status: 400,
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }
            
            const result = await soundcloud.getMusic(id);
            return new Response(JSON.stringify(result), {
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }
        
        if (pathname === '/download-url' && request.method === 'GET') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Parameter "id" is required' }), {
                    status: 400,
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }
            
            const result = await soundcloud.getDownloadUrl(id);
            return new Response(JSON.stringify(result), {
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }
        
        if (pathname === '/music-by-url' && request.method === 'GET') {
            const musicUrl = url.searchParams.get('url');
            if (!musicUrl) {
                return new Response(JSON.stringify({ error: 'Parameter "url" is required' }), {
                    status: 400,
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }
            
            const result = await soundcloud.getMusicWithUrl(musicUrl);
            return new Response(JSON.stringify(result), {
                headers: { ...headers, 'Content-Type': 'application/json' }
            });
        }
        
        if (pathname === '/direct-download' && request.method === 'GET') {
            const id = url.searchParams.get('id');
            if (!id) {
                return new Response(JSON.stringify({ error: 'Parameter "id" is required' }), {
                    status: 400,
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }
            
            const downloadInfo = await soundcloud.getDownloadUrl(id);
            
            if (!downloadInfo.status || !downloadInfo.download_url) {
                return new Response(JSON.stringify(downloadInfo), {
                    status: 400,
                    headers: { ...headers, 'Content-Type': 'application/json' }
                });
            }
            
            // ریدایرکت مستقیم به لینک دانلود
            return Response.redirect(downloadInfo.download_url, 302);
        }
        
        // Default route - API documentation
        return new Response(JSON.stringify({
            message: 'SoundCloud API Worker',
            endpoints: {
                '/search?q={query}': 'Search for music',
                '/music?id={id}': 'Get music by ID',
                '/download-url?id={id}': 'Get download URL for music by ID',
                '/direct-download?id={id}': 'Redirect to direct download URL',
                '/music-by-url?url={url}': 'Get music by SoundCloud URL'
            }
        }), {
            headers: { ...headers, 'Content-Type': 'application/json' }
        });
    }
};