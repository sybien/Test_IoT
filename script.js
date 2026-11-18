
"use strict";

// ==================================================
// PLC IoT SYSTEM - JAVASCRIPT
// HTML + CSS + NODE-RED + SIEMENS S7-1200
// ==================================================


// ==================================================
// 1. CONFIGURATION
// ==================================================

const CONFIG = {

    // Node-RED WebSocket address
    websocketURL: "ws://localhost:1880/iot/control",

    // true: Test with Node-RED simulation
    // false: Use real PLC data
    simulationMode: true,

    // Reconnect interval
    reconnectInterval: 3000,

    // Timeout for connection warning
    connectionTimeout: 5000,

    // Command timeout
    commandTimeout: 5000

};


// ==================================================
// 2. SYSTEM VARIABLES
// ==================================================

let socket = null;

let reconnectTimer = null;

let connectionTimer = null;

let commandTimer = null;

let pendingCommand = null;

let lastCommandId = null;

let isConnected = false;

let currentMotorStatus = false;


// ==================================================
// 3. GET HTML ELEMENTS
// ==================================================

const elements = {

    connection:
        document.getElementById("connection"),

    connectionLed:
        document.getElementById("connectionLed"),

    motorStatus:
        document.getElementById("motorStatus"),

    temperature:
        document.getElementById("temperature"),

    speed:
        document.getElementById("speed"),

    startBtn:
        document.getElementById("startBtn"),

    stopBtn:
        document.getElementById("stopBtn")

};


// ==================================================
// 4. CHECK HTML ELEMENTS
// ==================================================

function checkElements() {

    for (const [name, element] of Object.entries(elements)) {

        if (!element) {

            console.error(
                `HTML element not found: ${name}`
            );

        }

    }

}


// ==================================================
// 5. UPDATE CONNECTION STATUS
// ==================================================

function updateConnectionStatus(status) {

    isConnected = status;

    if (elements.connection) {

        elements.connection.innerText =
            status ? "Connected" : "Disconnected";

    }

    if (elements.connectionLed) {

        elements.connectionLed.className =
            status ? "led online" : "led offline";

    }

    updateButtons();

}


// ==================================================
// 6. ENABLE / DISABLE BUTTONS
// ==================================================

function updateButtons() {

    if (elements.startBtn) {

        elements.startBtn.disabled =
            !isConnected ||
            pendingCommand !== null ||
            currentMotorStatus;

    }

    if (elements.stopBtn) {

        elements.stopBtn.disabled =
            !isConnected ||
            pendingCommand !== null ||
            !currentMotorStatus;

    }

}


// ==================================================
// 7. UPDATE MOTOR STATUS
// ==================================================

function updateMotorStatus(status) {

    currentMotorStatus = Boolean(status);

    if (elements.motorStatus) {

        if (currentMotorStatus) {

            elements.motorStatus.innerText = "RUN";

            elements.motorStatus.className =
                "motor-status run";

        } else {

            elements.motorStatus.innerText = "STOP";

            elements.motorStatus.className =
                "motor-status stop";

        }

    }

    updateButtons();

}


// ==================================================
// 8. UPDATE MONITORING DATA
// ==================================================

function updateMonitoring(data) {

    if (
        typeof data.temperature === "number" &&
        Number.isFinite(data.temperature)
    ) {

        elements.temperature.innerText =
            data.temperature.toFixed(1) + " °C";

    }

    if (
        typeof data.speed === "number" &&
        Number.isFinite(data.speed)
    ) {

        elements.speed.innerText =
            data.speed.toFixed(0) + " RPM";

    }

}


// ==================================================
// 9. CONNECT TO NODE-RED
// ==================================================

function connectWebSocket() {

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {

        return;

    }

    console.log("Connecting to Node-RED...");

    updateConnectionStatus(false);

    socket = new WebSocket(CONFIG.websocketURL);


    // ----------------------------------------------
    // CONNECTION SUCCESS
    // ----------------------------------------------

    socket.onopen = function () {

        console.log("Node-RED connected!");

        clearTimeout(connectionTimer);

        updateConnectionStatus(true);

        socket.send(JSON.stringify({

            type: "STATUS_REQUEST"

        }));

    };


    // ----------------------------------------------
    // RECEIVE DATA
    // ----------------------------------------------

    socket.onmessage = function (event) {

        handleIncomingData(event.data);

    };


    // ----------------------------------------------
    // CONNECTION CLOSED
    // ----------------------------------------------

    socket.onclose = function () {

        console.warn("Node-RED disconnected!");

        updateConnectionStatus(false);

        clearTimeout(commandTimer);

        pendingCommand = null;

        updateButtons();

        scheduleReconnect();

    };


    // ----------------------------------------------
    // CONNECTION ERROR
    // ----------------------------------------------

    socket.onerror = function (error) {

        console.error("WebSocket error:", error);

    };

}


// ==================================================
// 10. HANDLE DATA FROM NODE-RED
// ==================================================

function handleIncomingData(rawData) {

    try {

        const data = JSON.parse(rawData);

        console.log("Received:", data);


        // ------------------------------------------
        // COMMAND ACKNOWLEDGEMENT
        // ------------------------------------------

        if (data.type === "ACK") {

            if (
                pendingCommand &&
                data.commandId === pendingCommand.id
            ) {

                clearTimeout(commandTimer);

                pendingCommand = null;

                if (data.accepted === false) {

                    console.warn(
                        "Command rejected:",
                        data.message
                    );

                }

                updateButtons();

            }

            return;

        }


        // ------------------------------------------
        // PLC STATUS
        // ------------------------------------------

        if (data.type === "STATUS") {

            if (typeof data.motorStatus === "boolean") {

                updateMotorStatus(data.motorStatus);

            }

            updateMonitoring(data);

            // A matching status can confirm a command.
            if (
                pendingCommand &&
                typeof data.motorStatus === "boolean"
            ) {

                const expectedStatus =
                    pendingCommand.command === "START";

                if (data.motorStatus === expectedStatus) {

                    clearTimeout(commandTimer);

                    pendingCommand = null;

                    updateButtons();

                }

            }

            return;

        }


        // ------------------------------------------
        // BASIC SIMULATION / COMPATIBILITY
        // ------------------------------------------

        if (typeof data.motorStatus === "boolean") {

            updateMotorStatus(data.motorStatus);

        }

        updateMonitoring(data);


    } catch (error) {

        console.error(
            "Invalid JSON received:",
            error
        );

    }

}


// ==================================================
// 11. SEND COMMAND
// ==================================================

function sendCommand(command) {

    if (!isConnected || socket.readyState !== WebSocket.OPEN) {

        console.warn("Node-RED is not connected!");

        return;

    }

    if (pendingCommand !== null) {

        console.warn("Another command is pending!");

        return;

    }

    if (command !== "START" && command !== "STOP") {

        console.error("Invalid command!");

        return;

    }

    const commandId =
        `${Date.now()}-${command}`;

    const message = {

        type: "COMMAND",

        command: command,

        commandId: commandId

    };

    socket.send(JSON.stringify(message));

    pendingCommand = {

        id: commandId,

        command: command

    };

    console.log("Command sent:", message);

    updateButtons();


    // ----------------------------------------------
    // COMMAND TIMEOUT
    // ----------------------------------------------

    commandTimer = setTimeout(function () {

        if (
            pendingCommand &&
            pendingCommand.id === commandId
        ) {

            console.warn(
                "Command acknowledgement timeout!"
            );

            pendingCommand = null;

            updateButtons();

        }

    }, CONFIG.commandTimeout);

}


// ==================================================
// 12. START BUTTON
// ==================================================

if (elements.startBtn) {

    elements.startBtn.addEventListener(
        "click",
        function () {

            sendCommand("START");

        }
    );

}


// ==================================================
// 13. STOP BUTTON
// ==================================================

if (elements.stopBtn) {

    elements.stopBtn.addEventListener(
        "click",
        function () {

            sendCommand("STOP");

        }
    );

}


// ==================================================
// 14. AUTOMATIC RECONNECTION
// ==================================================

function scheduleReconnect() {

    clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(function () {

        connectWebSocket();

    }, CONFIG.reconnectInterval);

}


// ==================================================
// 15. START SYSTEM
// ==================================================

function startSystem() {

    console.log("==============================");

    console.log("PLC IoT SYSTEM STARTING...");

    console.log("==============================");

    checkElements();

    updateConnectionStatus(false);

    updateMotorStatus(false);

    if (CONFIG.simulationMode) {

        console.log(
            "Simulation mode enabled. " +
            "Node-RED must provide simulated responses."
        );

    } else {

        console.log(
            "Real PLC mode enabled."
        );

    }

    connectWebSocket();

}


// ==================================================
// 16. INITIALIZE
// ==================================================

if (document.readyState === "loading") {

    document.addEventListener(
        "DOMContentLoaded",
        startSystem
    );
``
} else {

    startSystem();

}
