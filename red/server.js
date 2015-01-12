/**
 * Copyright 2013 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

var express = require('express');
var util = require('util');
var when = require('when');

var createUI = require("./ui");
var redNodes = require("./nodes");
var comms = require("./comms");

var localfilesystem = require("./storage/localfilesystem");
var fs = require('fs');
var exec = require('child_process').exec;
var crypto = require('crypto');
var requestJson = require('request-json');
var mqtt = require('mqtt');
var WebSocketServer = require('ws').Server
var querystring = require('querystring')


var app = null;
var nodeApp = null;
var server = null;
var settings = null;
var storage = null;

var wss = null;
// var mqttClient = null;

function createServer(_server,_settings) {
    server = _server;
    settings = _settings;
    comms.init(_server,_settings);
    storage = require("./storage");
    app = createUI(settings);
    nodeApp = express();


    app.get("/nodes",function(req,res) {
        res.send(redNodes.getNodeConfigs());
    });

    app.get("/flows",function(req,res) {
        console.log('ada')
        // res.json(redNodes.getFlows());

        /** force load flow from flows_hostname.json file when refresh webpage */
         redNodes.loadFlows().then( function() {
            res.json(redNodes.getFlows())
        }).otherwise(function(err) {
            util.log("[red] Error laoding flows : "+err);
            res.send(500,err.message);
        });

    });

    app.post("/flows",
        express.json(),
        function(req,res) {
            var flows = req.body;
            redNodes.setFlows(flows).then(function() {
                res.send(204);
            }).otherwise(function(err) {
                util.log("[red] Error saving flows : "+err);
                res.send(500,err.message);
            });
        },
        function(error,req,res,next) {
            res.send(400,"Invalid Flow");
        }
    );

    app.post("/nodes",
        express.json(),
        function(req,res) {
            var node = req.body;
            if (!node.file && !node.module) {
                res.send(400,"Invalid request");
                return;
            }
            redNodes.addNode(node).then(function(info) {
                comms.publish("node/added",info,false);
                util.log("[red] Added node types:");
                for (var i=0;i<info.types.length;i++) {
                    util.log("[red] - "+info.types[i]);
                }
                res.json(info);
            }).otherwise(function(err) {
                res.send(400,err.toString());
            });
        },
        function(err,req,res,next) {
            res.send(400,err);
        }
    );

    app.delete("/nodes/:id",
        function(req,res) {
            var id = req.params.id;
            try {
                var info = redNodes.removeNode(id);
                comms.publish("node/removed",info,false);
                util.log("[red] Removed node types:");
                for (var i=0;i<info.types.length;i++) {
                    util.log("[red] - "+info.types[i]);
                }
                res.json(info);
            } catch(err) {
                res.send(400,err.toString());
            }
        },
        function(err,req,res,next) {
            res.send(400,err);
        }
    );

    app.get("/nodes/:id", function(req,res) {
        var id = req.params.id;
        var config = redNodes.getNodeConfig(id);
        if (config) {
            res.send(config);
        } else {
            res.send(404);
        }
    });


    var flowStorage = []
    var gruopTopic = []
    app.post("/deploy", express.json(), function (request, response) {
        var fileName = localfilesystem.getSaveFlowFilePath();
        var data = request.body;

        // var uuid = genUuid(null);

        // get uniqure session id from object z attribute ( equals to tab id)
        var uuid = data.flow[0].z
        console.log("uuid: " + uuid);

        flowStorage.push({"session_id" : uuid, 'flow' : data.flow})

        fs.readFile(fileName, "utf8", function (err, oriData) {
            if (err) throw err
            console.log("read data")
            console.log(oriData)
            oriData = JSON.parse(oriData)

            /* for testing use */
            for (var i in data.flow) {
                if (typeof data.flow[i].deviceName != 'undefined') data.flow[i].deviceName = "Devise" + i;
            }

            data.session_id = uuid;

            /** Call Mapper servelt */
            var client = requestJson.newClient('http://localhost:8080');
            client.post("/Mapper-Servlet/Mappers", data, function (err, res, body) {
                if (!err && res.statusCode == 200) {

                    console.log('get response');
                    console.log(body);

                    if (body.success == false) {
                        return response.send(body);
                    }

                    // if (mqttClient == null) {
                    var mqttClient = mqtt.createClient(1883, 'localhost');
                    // }
                    var topicPrefix = "/formosa/" + uuid + "/"
                    var gruopTopicArray = []

                    for (var i in oriData) {
                        for (var j in body.flow) {
                            if (oriData[i].id == body.flow[j].id) {
                                oriData[i] = body.flow[j]

                                /** subscribe the topic for each node */
                                var topic = topicPrefix + body.flow[j].id
                                // mqttClient.subscribe(topic)
                                gruopTopicArray.push(topic)

                                // console.log("mosquitto_pub -h 127.0.0.1 -t " + topic + " -m  'mosquitto'")
                            }
                        }

                        if (oriData[i].type == "tab" && oriData[i].id == body.flow[0].z) {
                            oriData[i].deploy = true
                        }
                    }

                    /** subscribe the finish topic */
                    // mqttClient.subscribe(topicPrefix + "finish")
                    gruopTopic.push({session_id : uuid, topics : gruopTopicArray})

                    console.log(gruopTopic)

                    for (var i in gruopTopic) {
                        for (var j in gruopTopic[i].topics) {
                            /** subscribe the topic for each node */
                            mqttClient.subscribe(gruopTopic[i].topics[j])
                            console.log("mosquitto_pub -h 127.0.0.1 -t " + gruopTopic[i].topics[j] + " -m  'mosquitto'")
                        }
                        /** subscribe the finish topic */
                        mqttClient.subscribe("/formosa/" + gruopTopic[i].session_id + "/finish")
                        console.log("mosquitto_pub -h 127.0.0.1 -t " + "/formosa/" + gruopTopic[i].session_id + "/finish" + " -m  'mosquitto'")
                    }

                    if (wss === null) wss = new WebSocketServer({ port: 5566 });
                    body.webSocket = "ws://localhost:" + 5566;
                    /** websocket handler */
                    wss.on('connection', function connection(ws) {

                        ws.on('message', function incoming(message) {
                            console.log('received: %s', message);
                            // ws.close()
                            /** message arrive handler */
                            mqttClient.on('message', function (topic, message) {
                                console.log("topic: " + topic + "; message: " + message)
                                var splitArray = topic.split("/")
                                var session_id = splitArray[2]

                                if (splitArray[3] == 'finish') {
                                    console.log("RuleEngine Finish")
                                    for (var i = 0; i < flowStorage.length; i++) {
                                        if (flowStorage[i].session_id == session_id) {
                                            try {
                                                ws.send(JSON.stringify(flowStorage[i].flow))
                                                flowStorage.splice(i, 1)
                                                break
                                            } catch (e) {
                                                console.log('[webSocket] send error: ' + e);
                                            }
                                        }
                                    }
                                    for (var i = 0; i < gruopTopic.length; i++) {
                                        if (gruopTopic[i].session_id == session_id) {
                                            console.log("unsubscribe topics: " + gruopTopic[i].topics)
                                            mqttClient.unsubscribe(gruopTopic[i].topics)
                                            gruopTopic.splice(i, 1)
                                            break;
                                        }
                                    }
                                } else {
                                    var nodeId = splitArray[splitArray.length - 1]
                                    try {
                                        console.log("[websocket] send: " + nodeId);
                                        ws.send(nodeId);
                                    } catch (e) {
                                        console.log('[webSocket] send error: ' + e);
                                    }

                                }

                            })
                        });
                        // ws.send('something');

                        ws.on('close', function close() {
                            console.log('websocket disconnected');
                            ws.close()
                        });
                    });



                    /** write to flow config file */
                    fs.writeFile(fileName, JSON.stringify(oriData), function (err) {
                        if (err) throw err;
                        // var websocket = comms.getWebsocket();

                        // webSocket.send("!!!!@@@ Maydaycha");

                        console.log("=============");
                        console.log(oriData);
                        console.log("=============");

                        return response.json(body);
                    });

                } else {
                    response.send(404);
                }
            });
        });
    });

    app.delete("/undeploy", express.json(), function (request, response) {
        console.log('get reqeust')
        var fileName = localfilesystem.getSaveFlowFilePath();

        var data = request.body;

        /** trick for pass params who has "."" */
        data.session_id = data.session_id.replace(".", "_")

        var client = requestJson.newClient('http://localhost:8080');

        var path = "/Mapper-Servlet/Mappers/" + data.session_id

        console.log(path)


        client.del(path, null, function (error, res, body) {
            if (!error && res.statusCode == 200) {
                console.log(body);
                data.session_id = data.session_id.replace("_", ".")
                fs.readFile(fileName, "utf8", function (err, oriData) {
                    oriData = JSON.parse(oriData);
                    for (var i in oriData) {
                        if (oriData[i].type == "tab" && oriData[i].id == data.session_id) {
                            oriData[i].deploy = false;
                        }
                    }
                    fs.writeFile(fileName, JSON.stringify(oriData), function (err) {
                        response.json(request.body);
                        response.end();
                    });
                });
            } else {
                console.log('deploy reqeust error: ' + error);
                response.json(request.body);
                response.end();
            }
        });
    });
}


function start() {
    var defer = when.defer();

    storage.init(settings).then(function() {
        console.log("\nWelcome to Node-RED\n===================\n");
        if (settings.version) {
            util.log("[red] Version: "+settings.version);
        }
        util.log("[red] Loading palette nodes");
        redNodes.init(settings,storage);
        redNodes.load().then(function() {
            var nodes = redNodes.getNodeList();
            var nodeErrors = nodes.filter(function(n) { return n.err!=null;});
            if (nodeErrors.length > 0) {
                util.log("------------------------------------------");
                if (settings.verbose) {
                    for (var i=0;i<nodeErrors.length;i+=1) {
                        util.log("["+nodeErrors[i].name+"] "+nodeErrors[i].err);
                    }
                } else {
                    util.log("[red] Failed to register "+nodeErrors.length+" node type"+(nodeErrors.length==1?"":"s"));
                    util.log("[red] Run with -v for details");
                }
                util.log("------------------------------------------");
            }
            defer.resolve();

            redNodes.loadFlows();
        });
        comms.start();
    }).otherwise(function(err) {
        defer.reject(err);
    });

    return defer.promise;
}

function stop() {
    redNodes.stopFlows();
    comms.stop();
}

/** uuid for identified user session */
function genUuid (callback) {
    if (typeof callback != 'function') {
        return uuidFromBytes(crypto.randomBytes(16));
    }

    /** if have callback function, execute it */
    crypto.randomBytes(16, function(err, rnd) {
        if (err) return callback(err);
        callback(null, uuidFromBytes(rnd));
  });
}

function uuidFromBytes (rnd) {
    rnd[6] = (rnd[6] & 0x0f) | 0x40;
    rnd[8] = (rnd[8] & 0x3f) | 0x80;
    rnd = rnd.toString('hex').match(/(.{8})(.{4})(.{4})(.{4})(.{12})/);
    rnd.shift();
    return rnd.join('-');
}

module.exports = {
    init: createServer,
    start: start,
    stop: stop
}

module.exports.__defineGetter__("app", function() { return app });
module.exports.__defineGetter__("nodeApp", function() { return nodeApp });
module.exports.__defineGetter__("server", function() { return server });
