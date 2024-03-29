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
var RED = (function() {

    $('#btn-keyboard-shortcuts').click(function(){showHelp();});

    function hideDropTarget() {
        $("#dropTarget").hide();
        RED.keyboard.remove(/* ESCAPE */ 27);
    }

    $('#chart').on("dragenter",function(event) {
        if ($.inArray("text/plain",event.originalEvent.dataTransfer.types) != -1) {
            $("#dropTarget").css({display:'table'});
            RED.keyboard.add(/* ESCAPE */ 27,hideDropTarget);
        }
    });

    $('#dropTarget').on("dragover",function(event) {
        if ($.inArray("text/plain",event.originalEvent.dataTransfer.types) != -1) {
            event.preventDefault();
        }
    })
    .on("dragleave",function(event) {
        hideDropTarget();
    })
    .on("drop",function(event) {
        var data = event.originalEvent.dataTransfer.getData("text/plain");
        hideDropTarget();
        RED.view.importNodes(data);
        event.preventDefault();
    });


    function save(force) {
        if (RED.view.dirty()) {

            if (!force) {
                var invalid = false;
                var unknownNodes = [];
                RED.nodes.eachNode(function(node) {
                    invalid = invalid || !node.valid;
                    if (node.type === "unknown") {
                        if (unknownNodes.indexOf(node.name) == -1) {
                            unknownNodes.push(node.name);
                        }
                        invalid = true;
                    }
                });
                if (invalid) {
                    if (unknownNodes.length > 0) {
                        $( "#node-dialog-confirm-deploy-config" ).hide();
                        $( "#node-dialog-confirm-deploy-unknown" ).show();
                        var list = "<li>"+unknownNodes.join("</li><li>")+"</li>";
                        $( "#node-dialog-confirm-deploy-unknown-list" ).html(list);
                    } else {
                        $( "#node-dialog-confirm-deploy-config" ).show();
                        $( "#node-dialog-confirm-deploy-unknown" ).hide();
                    }
                    $( "#node-dialog-confirm-deploy" ).dialog( "open" );
                    return;
                }
            }
            var nns = RED.nodes.createCompleteNodeSet();

            $("#btn-icn-deploy").removeClass('icon-upload');
            $("#btn-icn-deploy").addClass('spinner');
            RED.view.dirty(false);

            $.ajax({
                url:"flows",
                type: "POST",
                data: JSON.stringify(nns),
                contentType: "application/json; charset=utf-8"
            }).done(function(data,textStatus,xhr) {
                // RED.notify("Successfully deployed","success");
                RED.nodes.eachNode(function(node) {
                    if (node.changed) {
                        node.dirty = true;
                        node.changed = false;
                    }
                    if(node.credentials) {
                        delete node.credentials;
                    }
                });
                RED.nodes.eachConfig(function (confNode) {
                    if (confNode.credentials) {
                        delete confNode.credentials;
                    }
                });

                // Once deployed, cannot undo back to a clean state
                RED.history.markAllDirty();
                RED.view.redraw();
            }).fail(function(xhr,textStatus,err) {
                RED.view.dirty(true);
                if (xhr.responseText) {
                    RED.notify("<strong>Error</strong>: "+xhr.responseText,"error");
                } else {
                    RED.notify("<strong>Error</strong>: no response from server","error");
                }
            }).always(function() {
                $("#btn-icn-deploy").removeClass('spinner');
                $("#btn-icn-deploy").addClass('icon-upload');
            });
        }
    }

    // $("#btn-discovery").click(function () {
    //     RED.view.selectAll();
    //     save();
    //     console.log(RED.view);
    //     RED.view.showExportNodesDialog();
    // })

    $('#btn-deploy').click(function() {
        RED.view.selectAll();
        save();
        console.log(RED.view);
        RED.view.showExportNodesDialog();
    });

    $("#btn-undeploy").click( function () {
        RED.view.selectAll();
        // var nns = RED.nodes.createCompleteNodeSet();
        // console.log(nns);
        var data = RED.view.getDesignFlow();

        console.log('get desginData');
        console.log(data);

        if (typeof data != "undefined") {
            var params = {"session_id" : data[0].z};
            console.log(params);
            $.ajax({
                url: "/undeploy",
                method: "delete",
                data: JSON.stringify(params),
                headers: {
                    "Accept" : "application/json; charset=utf-8",
                    "Content-Type" : "application/json; charset=utf-8"
                },
                success: function(data) {
                    console.log('undeploy success');
                    console.log(data);
                    location.reload()
                }
            });
        }
    });

    $( "#node-dialog-confirm-deploy" ).dialog({
            title: "Confirm deploy",
            modal: true,
            autoOpen: false,
            width: 530,
            height: 230,
            buttons: [
                {
                    text: "Confirm deploy",
                    click: function() {
                        save(true);
                        $( this ).dialog( "close" );
                    }
                },
                {
                    text: "Cancel",
                    click: function() {
                        $( this ).dialog( "close" );
                    }
                }
            ]
    });

    function loadSettings() {
        $.get('settings', function(data) {
            RED.settings = data;
            console.log("Node-RED: "+data.version);
            loadNodes();
        });
    }
    function loadNodes() {
        $.get('nodes', function(data) {
            $("body").append(data);
            $(".palette-spinner").hide();
            $(".palette-scroll").show();
            $("#palette-search").show();
            loadFlows();
        });
    }

    function loadFlows() {
        $.getJSON("flows",function(nodes) {
            console.log("flows");
            console.log(nodes)
            RED.nodes.import(nodes);
            RED.view.dirty(false);
            RED.view.redraw();
            RED.comms.subscribe("status/#",function(topic,msg) {
                var parts = topic.split("/");
                var node = RED.nodes.node(parts[1]);
                if (node) {
                    node.status = msg;
                    if (statusEnabled) {
                        node.dirty = true;
                        RED.view.redraw();
                    }
                }
            });
            RED.comms.subscribe("node/#",function(topic,msg) {
                var i;
                if (topic == "node/added") {
                    for (i=0;i<msg.length;i++) {
                        var m = msg[i];
                        var id = m.id;
                        $.get('nodes/'+id, function(data) {
                            $("body").append(data);
                            var typeList = "<ul><li>"+m.types.join("</li><li>")+"</li></ul>";
                            RED.notify("Node"+(m.types.length!=1 ? "s":"")+" added to palette:"+typeList,"success");
                        });
                    }
                } else if (topic == "node/removed") {
                    if (msg.types) {
                        for (i=0;i<msg.types.length;i++) {
                            RED.palette.remove(msg.types[i]);
                        }
                        var typeList = "<ul><li>"+msg.types.join("</li><li>")+"</li></ul>";
                        RED.notify("Node"+(msg.types.length!=1 ? "s":"")+" removed from palette:"+typeList,"success");
                    }
                }
            });

            setUpWebSocket()

        });

    }
    function setUpWebSocket () {
        var socketClient = new WebSocket("ws://localhost:5566");
        var nodeIds = [];

        var timeoutReference = {}

        socketClient.onopen = function (event) {
            console.log("connect sokcet")
            socketClient.send('start flag')
        }
        socketClient.onclose = function (event) {
            console.log('socket disconnected')
        }
        socketClient.onmessage = function (event) {
            // var data = JSON.parse(event.data);
            console.log(event.data)
            try {
                var flow = JSON.parse(event.data);
                console.log('[timeput] re deploy')
                console.log(flow)

                /** re-deploy */
                // socketClient.close()
                if (typeof flow != "undefined") {
                    var params = {"session_id" : flow[0].z};
                    console.log(params);
                    $.ajax({
                        url: "/undeploy",
                        method: "delete",
                        data: JSON.stringify(params),
                        headers: {
                            "Accept" : "application/json; charset=utf-8",
                            "Content-Type" : "application/json; charset=utf-8"
                        },
                        success: function(data) {
                            console.log('undeploy success');
                            console.log(data);
                            /** redeploy */
                            setTimeout( function (flow) {
                                console.log("********** redeploy ************")
                                RED.view.showExportNodesDialog(flow);
                            }, 7000, flow)
                            // RED.view.showExportNodesDialog(flow);
                            // location.reload()
                        }
                    });
                }
            } catch (err) {
                /** if node id is not be persistence, store it */
                if (nodeIds.indexOf(event.data) == -1) {
                    nodeIds.push(event.data);
                }
                /** change the color of node which is acting currently */
                // for (var i in nodeIds) {
                //     if (nodeIds[i] == event.data) {
                //         if (document.getElementById(nodeIds[i]) != null) document.getElementById(nodeIds[i]).firstChild.style.stroke = "blue";
                //     } else {
                //         if (document.getElementById(nodeIds[i]) != null) document.getElementById(nodeIds[i]).firstChild.style.stroke = "#999";
                //     }
                // }
                if (document.getElementById(event.data) != null) {
                    if (document.getElementById(event.data).firstChild.style.stroke != "#FF4000") {
                        if (typeof timeoutReference[event.data] != 'undefined') {
                            clearTimeout(timeoutReference[event.data])
                        }
                        var d = document.getElementById(event.data).firstChild
                        d.style.stroke = "#FF4000"
                        d.style.strokeWidth = 4;
                    }
                }

                timeoutReference[event.data] = setTimeout(function (ele) {
                    if (document.getElementById(ele) != null) {
                        var d = document.getElementById(ele).firstChild
                        d.style.stroke = "#999"
                        d.style.strokeWidth = 2
                    }
                }, 500, event.data)

            }
        }
        socketClient.onerror = function (event) {
            console.log('socket error')
        }


    }

    $('#btn-node-status').click(function() {toggleStatus();});

    var statusEnabled = false;
    function toggleStatus() {
        var btnStatus = $("#btn-node-status");
        statusEnabled = btnStatus.toggleClass("active").hasClass("active");
        RED.view.status(statusEnabled);
    }

    function showHelp() {

        var dialog = $('#node-help');

        //$("#node-help").draggable({
        //        handle: ".modal-header"
        //});

        dialog.on('show',function() {
            RED.keyboard.disable();
        });
        dialog.on('hidden',function() {
            RED.keyboard.enable();
        });

        dialog.modal();
    }

    $(function() {
        RED.keyboard.add(/* ? */ 191,{shift:true},function(){showHelp();d3.event.preventDefault();});
        loadSettings();
        RED.comms.connect();
    });

    return {
    };
})();
