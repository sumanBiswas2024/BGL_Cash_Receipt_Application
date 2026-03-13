/* global QUnit */
QUnit.config.autostart = false;

sap.ui.require(["com/bgl/app/cashreceipt/test/integration/AllJourneys"
], function () {
	QUnit.start();
});
