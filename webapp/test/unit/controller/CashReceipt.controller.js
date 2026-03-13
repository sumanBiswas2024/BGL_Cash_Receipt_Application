/*global QUnit*/

sap.ui.define([
	"com/bgl/app/cashreceipt/controller/CashReceipt.controller"
], function (Controller) {
	"use strict";

	QUnit.module("CashReceipt Controller");

	QUnit.test("I should test the CashReceipt controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
