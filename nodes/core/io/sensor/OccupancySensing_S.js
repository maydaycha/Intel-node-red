module.exports = function(RED) {
    function SensorIn(config) {
        RED.nodes.createNode(this, config);

        var node = this;

        this.on('input', function(msg) {
            msg.payload = msg.payload.toLowerCase();
            node.send(msg);
        });

        // this.on('close', function () {
        // });
    }
    RED.nodes.registerType("OccupancySensing_S", SensorIn);
}
