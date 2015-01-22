module.exports = function(RED) {
    function ActuatorOut(config) {
        RED.nodes.createNode(this, config);

        var node = this;

        this.on('input', function(msg) {
            msg.payload = msg.payload.toLowerCase();
            node.send(msg);
        });

        this.on('close', function () {
            console.log('close!');
        });
    }
    RED.nodes.registerType("Less_Than", ActuatorOut);
}
