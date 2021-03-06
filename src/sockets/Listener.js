const WebSocket = require("uws");
const WebSocketServer = WebSocket.Server;

const Connection = require("./Connection");
const ChatChannel = require("./ChatChannel");

class Listener {
    /**
     * @param {ServerHandle} handle
     */
    constructor(handle) {
        /** @type {WebSocketServer} */
        this.listenerSocket = null;
        this.handle = handle;
        this.globalChat = new ChatChannel(this);

        /** @type {PlayingRouter[]} */
        this.allPlayingRouters = [];
        /** @type {Connection[]} */
        this.connections = [];
    }

    get settings() { return this.handle.settings; }
    get logger() { return this.handle.logger; }

    open() {
        if (this.listenerSocket !== null) return false;
        this.logger.debug(`listener opening at ${this.settings.listeningPort}`);
        this.listenerSocket = new WebSocketServer({
            port: this.settings.listeningPort,
            verifyClient: this.verifyClient.bind(this)
        }, this.onOpen.bind(this));
        this.listenerSocket.on("connection", this.onConnection.bind(this));
        return true;
    }
    close() {
        if (this.listenerSocket === null) return false;
        this.logger.debug("listener closing");
        this.listenerSocket.close();
        this.listenerSocket = null;
        return true;
    }

    verifyClient(info, response) {
        this.logger.onAccess(`REQUEST FROM ${info.req.socket.remoteAddress}, ${info.secure ? "" : "not "}secure, Origin: ${info.origin}`);
        if (this.settings.listenerAcceptedOrigins !== null) {
            const split = this.settings.listenerAcceptedOrigins.split(" ");
            let matches = false;
            for (let i = 0, l = split.length; i < l; i++)
                if (info.origin === split[i]) { matches = true; break; }
            this.logger.debug(`socketAcceptedOrigins is defined; did ${info.origin} pass: ${matches}`);
            if (!matches) return void response(false, 403, "Forbidden");
        }
        if (this.connections.length > this.settings.listenerMaxConnections) {
            this.logger.debug("too many connections, drop new ones!");
            return void response(false, 503, "Service Unavailable");
        }
        // TODO: IP checks
        this.logger.debug("client verification passed");
        response(true);
    }
    onOpen() {
        this.logger.inform(`listener open at ${this.settings.listeningPort}`);
    }

    /**
     * @param {PlayingRouter} router
     */
    addPlayingRouter(router) {
        this.allPlayingRouters.push(router);
    }
    /**
     * @param {PlayingRouter} router
     */
    removePlayingRouter(router) {
        this.allPlayingRouters.splice(this.allPlayingRouters.indexOf(router), 1);
    }

    /**
     * @param {WebSocket} webSocket
     */
    onConnection(webSocket) {
        const newConnection = new Connection(this, webSocket);
        this.logger.onAccess(`CONNECTION FROM ${newConnection.remoteAddress}`);
        newConnection.createPlayer();
        this.connections.push(newConnection);
        this.globalChat.add(newConnection);
        if (this.settings.matchmakerNeedsQueuing) {
            this.globalChat.directMessage(null, newConnection, "This server requires players to be queued.");
            this.globalChat.directMessage(null, newConnection, "Try spawning to enqueue.");
        } else this.handle.matchmaker.enqueue(newConnection);
    }

    /**
     * @param {Connection} connection
     * @param {Number} code
     * @param {String} reason
     */
    onDisconnection(connection, code, reason) {
        this.logger.onAccess(`DISCONNECTION FROM ${connection.remoteAddress} (${code} '${reason}')`);
        this.globalChat.remove(connection);
        this.connections.splice(this.connections.indexOf(connection), 1);
    }

    update() {
        let i, l;
        for (i = 0, l = this.allPlayingRouters.length; i < l; i++) {
            const router = this.allPlayingRouters[i];
            router.update();
            if (router.isDisconnected) i--, l--;
        }
        
        for (i = 0, l = this.connections.length; i < l; i++) {
            const connection = this.connections[i];
            if (Date.now() - connection.lastActivityTime < this.settings.listenerMaxClientDormancy) continue;
            connection.closeSocket(1003, "Maximum dormancy time exceeded");
        }
    }
}

module.exports = Listener;

const PlayingRouter = require("../primitives/PlayingRouter");
const ServerHandle = require("../ServerHandle");