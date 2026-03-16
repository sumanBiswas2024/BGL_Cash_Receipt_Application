// sap.ui.define([
//     "sap/ui/core/mvc/Controller"
// ], (Controller) => {
//     "use strict";

//     return Controller.extend("com.bgl.app.cashreceipt.controller.CashReceipt", {
//         onInit() {
//         }
//     });
// });

sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/comp/smartvariants/PersonalizableInfo",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, PersonalizableInfo, MessageBox, MessageToast) {
    "use strict";

    // ═══════════════════════════════════════════════════════════════════════════
    //  AMOUNT → WORDS  (Indian system: Lakh / Crore)
    // ═══════════════════════════════════════════════════════════════════════════
    var _ones = [
        "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
        "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
        "SEVENTEEN", "EIGHTEEN", "NINETEEN"
    ];
    var _tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY",
        "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

    function _numToWords(n) {
        if (n === 0) { return ""; }
        if (n < 20) { return _ones[n]; }
        if (n < 100) { return _tens[Math.floor(n / 10)] + (n % 10 ? " " + _ones[n % 10] : ""); }
        if (n < 1000) { return _ones[Math.floor(n / 100)] + " HUNDRED" + (n % 100 ? " " + _numToWords(n % 100) : ""); }
        if (n < 100000) { return _numToWords(Math.floor(n / 1000)) + " THOUSAND" + (n % 1000 ? " " + _numToWords(n % 1000) : ""); }
        if (n < 10000000) { return _numToWords(Math.floor(n / 100000)) + " LAKH" + (n % 100000 ? " " + _numToWords(n % 100000) : ""); }
        return _numToWords(Math.floor(n / 10000000)) + " CRORE" + (n % 10000000 ? " " + _numToWords(n % 10000000) : "");
    }

    function _amountToWords(fAmount) {
        if (fAmount === null || fAmount === undefined || fAmount === "") { return ""; }
        var fParsed = parseFloat(fAmount);
        if (isNaN(fParsed)) { return ""; }
        var parts = fParsed.toFixed(2).split(".");
        var rupees = parseInt(parts[0], 10);
        var paise = parseInt(parts[1], 10);
        var sWords = rupees > 0 ? _numToWords(rupees) + " RUPEES" : "ZERO RUPEES";
        if (paise > 0) { sWords += " AND " + _numToWords(paise) + " PAISE"; }
        return sWords + " ONLY";
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPER – extract 4-digit year string from DatePicker
    //  DatePicker getValue() returns the displayFormat string e.g. "2025"
    //  getDateValue() returns a JS Date object (or null if empty/invalid)
    // ═══════════════════════════════════════════════════════════════════════════
    /**
     * Read fiscal year as a 4-digit string ("2025") from the DatePicker.
     * Primary source: the JS Date stored at /valueDP11 in the view's default model.
     * Fallback:       getDateValue() directly on the DatePicker control.
     */
    function _getFiscalYear(oView, oDP) {
        // Primary: model-driven value (bound to /valueDP11)
        var oModel = oView ? oView.getModel() : null;
        if (oModel) {
            var vModelVal = oModel.getProperty("/valueDP11");
            if (vModelVal instanceof Date && !isNaN(vModelVal.getTime())) {
                return String(vModelVal.getFullYear());
            }
        }
        // Fallback: getDateValue() on the control itself
        if (oDP) {
            var oDate = oDP.getDateValue();
            if (oDate && !isNaN(oDate.getTime())) {
                return String(oDate.getFullYear());
            }
        }
        return "";
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CONTROLLER
    // ═══════════════════════════════════════════════════════════════════════════
    return Controller.extend("com.bgl.app.cashreceipt.controller.CashReceipt", {

        // ───────────────────────────────────────────────────────────────────────
        //  onInit
        // ───────────────────────────────────────────────────────────────────────
        onInit: function () {
            this._pdfBlobUrl = null;

            // ── Local JSONModel – backs the DatePicker binding path /valueDP11 ──
            // The DatePicker is bound to: path '/valueDP11', type 'sap.ui.model.type.Date',
            // formatOptions { pattern: 'yyyy' }  →  displays only the year e.g. "2025"
            var oLocalModel = new JSONModel({ valueDP11: null });
            this.getView().setModel(oLocalModel);   // set as default (unnamed) model

            // ── Busy dialog ────────────────────────────────────────────────────
            this._busyDialog = new sap.m.Dialog({
                showHeader: false,
                type: "Message",
                content: new sap.m.VBox({
                    justifyContent: "Center",
                    alignItems: "Center",
                    items: [
                        new sap.m.BusyIndicator({ size: "2rem" }),
                        new sap.m.Text({
                            text: "Generating Cash Receipt, please wait...",
                            textAlign: "Center"
                        }).addStyleClass("sapUiSmallMarginTop")
                    ]
                }),
                contentWidth: "280px",
                contentHeight: "120px",
                verticalScrolling: false,
                horizontalScrolling: false
            });

            // ── SmartVariantManagement + FilterBar (same pattern as BarCodeView) ──
            this.oSmartVariantManagement = this.getView().byId("svm");
            this.oExpandedLabel = this.getView().byId("expandedLabel");
            this.oSnappedLabel = this.getView().byId("snappedLabel");
            this.oFilterBar = this.getView().byId("filterbar");

            this.oFilterBar.registerFetchData(this.fetchData.bind(this));
            this.oFilterBar.registerApplyData(this.applyData.bind(this));
            this.oFilterBar.registerGetFiltersWithValues(this.getFiltersWithValues.bind(this));

            var oPersInfo = new PersonalizableInfo({
                type: "filterBar", keyName: "persistencyKey",
                dataSource: "", control: this.oFilterBar
            });
            this.oSmartVariantManagement.addPersonalizableControl(oPersInfo);
            this.oSmartVariantManagement.initialise(function () { }, this.oFilterBar);

            this._setPdfPlaceholder();
        },

        // ───────────────────────────────────────────────────────────────────────
        //  onExit
        // ───────────────────────────────────────────────────────────────────────
        onExit: function () {
            this.oSmartVariantManagement = null;
            this.oExpandedLabel = null;
            this.oSnappedLabel = null;
            this.oFilterBar = null;
            if (this._pdfBlobUrl) { URL.revokeObjectURL(this._pdfBlobUrl); }
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  SmartVariantManagement stubs
        // ═══════════════════════════════════════════════════════════════════════
        fetchData: function () {
            // Save current filter state into the variant
            var oDP = this.byId("idFiscalYearDP");
            return {
                documentNo: this.byId("idDocumentNoInput").getValue(),
                fiscalYear: _getFiscalYear(this.getView(), oDP)   // store as "2025" string
            };
        },

        applyData: function (oData) {
            // Restore filter state when a variant is loaded
            if (!oData) { return; }

            if (oData.documentNo !== undefined) {
                this.byId("idDocumentNoInput").setValue(oData.documentNo);
            }

            if (oData.fiscalYear) {
                // Convert "2025" back to a Date and push into the default model (/valueDP11)
                // so the DatePicker binding picks it up
                var oDate = new Date(parseInt(oData.fiscalYear, 10), 0, 1); // Jan 1 of that year
                this.getView().getModel().setProperty("/valueDP11", oDate);
            }
        },

        getFiltersWithValues: function () {
            var aActive = [];
            var aItems = this.oFilterBar ? this.oFilterBar.getFilterGroupItems() : [];
            if (this.byId("idDocumentNoInput").getValue()) { aActive.push(aItems[1]); }
            if (_getFiscalYear(this.getView(), this.byId("idFiscalYearDP"))) { aActive.push(aItems[2]); }
            return aActive;
        },

        onFilterChange: function () {
            var iCount = this.getFiltersWithValues().length;
            var sText = iCount > 0 ? iCount + " filter(s) active" : "No filters active";
            if (this.oExpandedLabel) { this.oExpandedLabel.setText(sText); }
            if (this.oSnappedLabel) { this.oSnappedLabel.setText(sText); }
        },

        onAfterVariantLoad: function () { this.onFilterChange(); },

        // ═══════════════════════════════════════════════════════════════════════
        //  INPUT HANDLERS
        // ═══════════════════════════════════════════════════════════════════════

        /** Document No – clear error state as user types; reset PDF if emptied */
        onDocumentNoClear: function (oEvent) {
            var sValue = oEvent.getParameter("value");
            var oInput = this.byId("idDocumentNoInput");
            if (sValue) {
                oInput.setValueState(sap.ui.core.ValueState.None).setValueStateText("");
            } else {
                this._resetPdfArea();
            }
        },

        /**
         * Fiscal Year DatePicker change handler.
         * The 'change' event fires when the user picks a date or types manually.
         * oEvent parameters:
         *   valid  (boolean) – whether the typed value parsed successfully
         *   value  (string)  – raw string in displayFormat ("2025")
         */
        onFiscalYearChange: function (oEvent) {
            var bValid = oEvent.getParameter("valid");
            var oDP = this.byId("idFiscalYearDP");

            if (bValid && _getFiscalYear(this.getView(), oDP)) {
                // Clear any previous error
                oDP.setValueState(sap.ui.core.ValueState.None).setValueStateText("");
            } else if (!bValid) {
                // User typed an invalid value (e.g. letters, wrong format)
                oDP.setValueState(sap.ui.core.ValueState.Error)
                    .setValueStateText("Please enter a valid year (e.g. 2025).");
            } else {
                // Field cleared
                this._resetPdfArea();
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  VALIDATION
        // ═══════════════════════════════════════════════════════════════════════
        _validateInputs: function () {

            var oCompInput = this.byId("idComCode");
            var oDocInput = this.byId("idDocumentNoInput");
            var oDP = this.byId("idFiscalYearDP");
            var bValid = true;
            var aMessages = [];

            // ── Company Code ────────────────────────────────────────────────────
            var sCompCode = (oCompInput.getValue() || "").trim();
            if (!sCompCode) {
                oCompInput.setValueState(sap.ui.core.ValueState.Error)
                    .setValueStateText("Company Code is required.");
                aMessages.push("Company Code");
                bValid = false;
            } else {
                oCompInput.setValueState(sap.ui.core.ValueState.None).setValueStateText("");
            }

            // ── Document No ────────────────────────────────────────────────────
            var sDocNo = (oDocInput.getValue() || "").trim();
            if (!sDocNo) {
                oDocInput.setValueState(sap.ui.core.ValueState.Error)
                    .setValueStateText("Document No is required.");
                aMessages.push("Document No");
                bValid = false;
            } else {
                oDocInput.setValueState(sap.ui.core.ValueState.None).setValueStateText("");
            }

            // ── Fiscal Year ────────────────────────────────────────────────────
            var sFY = _getFiscalYear(this.getView(), oDP);

            if (!sFY) {
                // Nothing selected / empty
                oDP.setValueState(sap.ui.core.ValueState.Error)
                    .setValueStateText("Fiscal Year is required.");
                aMessages.push("Fiscal Year");
                bValid = false;
            } else if (oDP.getValueState() === sap.ui.core.ValueState.Error) {
                // DatePicker already flagged an invalid entry (e.g. "abcd")
                aMessages.push("Fiscal Year (invalid value)");
                bValid = false;
            } else {
                oDP.setValueState(sap.ui.core.ValueState.None).setValueStateText("");
            }

            if (!bValid) {
                MessageBox.error(
                    "Please fill the following required field(s):\n\n• " +
                    aMessages.join("\n• ")
                );
            }
            return bValid;
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  onSearch  (FilterBar Go button)
        // ═══════════════════════════════════════════════════════════════════════
        onSearch: function () {
            if (!this._validateInputs()) { return; }

            this._busyDialog.open();
            this._fetchReceiptData();
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  OData FETCH
        //  Service  : ZSB_PAYMENT_RECEIPT
        //  URL      : /ZI_PAYMENT_RECEIPT(p_companycode='1000',
        //                                  p_documentno='1400000038',
        //                                  p_fiscalyear='2025')/Set
        // ═══════════════════════════════════════════════════════════════════════
        _fetchReceiptData: function () {
            var that = this;

            var sCompanyCode = (this.byId("idComCode").getValue() || "").trim();
            var sDocNo = (this.byId("idDocumentNoInput").getValue() || "").trim();
            var sFiscalYear = _getFiscalYear(this.getView(), this.byId("idFiscalYearDP")); // "2025"

            var sPath = "/ZI_PAYMENT_RECEIPT(" +
                "p_companycode='" + sCompanyCode + "'," +
                "p_documentno='" + sDocNo + "'," +
                "p_fiscalyear='" + sFiscalYear + "'" +
                ")/Set";

            console.log("OData path:", sPath);
            // sap.ui.core.BusyIndicator.show(0);

            this.getOwnerComponent().getModel().read(sPath, {
                success: function (oData) {

                    var aResults = oData.results || [];
                    console.log("Receipt data:", aResults);

                    if (!aResults.length) {
                        that._busyDialog.close();
                        MessageBox.warning(
                            "No receipt found for:\n" +
                            "  Company Code : " + sCompanyCode + "\n" +
                            "  Document No : " + sDocNo + "\n" +
                            "  Fiscal Year : " + sFiscalYear
                        );
                        that._resetPdfArea();
                        return;
                    }
                    that._loadPdfMakeLibrary(aResults);

                    // sap.ui.core.BusyIndicator.hide();
                },
                error: function (oErr) {
                    // sap.ui.core.BusyIndicator.hide();
                    that._busyDialog.close();
                    console.error("OData error:", oErr);
                    that._handleODataError(oErr, sDocNo, sFiscalYear);
                }
            });
        },

        /** Parse OData error and show a user-friendly MessageBox */
        _handleODataError: function (oErr, sDocNo, sFiscalYear) {
            var sMsg = "Failed to fetch receipt data.";
            try {
                var oBody = JSON.parse(oErr.responseText);
                var sDetail = (oBody.error && oBody.error.message && oBody.error.message.value)
                    ? oBody.error.message.value : "";

                if (oErr.statusCode === 404 ||
                    (sDetail && sDetail.toLowerCase().indexOf("not found") > -1)) {
                    sMsg = "No receipt found for Document No \"" + sDocNo +
                        "\" in Fiscal Year " + sFiscalYear +
                        ".\nPlease verify the inputs.";
                } else if (oErr.statusCode === 401 || oErr.statusCode === 403) {
                    sMsg = "You do not have authorization to view this receipt.";
                } else if (sDetail) {
                    sMsg = sDetail;
                } else if (oErr.statusCode) {
                    sMsg += " (HTTP " + oErr.statusCode + ")";
                }
            } catch (e) {
                if (oErr.statusCode) { sMsg += " (HTTP " + oErr.statusCode + ")"; }
            }
            MessageBox.error(sMsg);
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  LOAD pdfMake LIBS (sequential, same pattern as BarCodeView)
        // ═══════════════════════════════════════════════════════════════════════
        _loadPdfMakeLibrary: function (aResults) {
            var that = this;
            var sBase = jQuery.sap.getModulePath("com.bgl.app.cashreceipt");
            // sap.ui.core.BusyIndicator.show(0);

            jQuery.sap.includeScript(sBase + "/libs/pdfmake/pdfmake.min.js", "pdfMakeScript",
                function () {
                    console.log(" pdfMake loaded successfully.");
                    jQuery.sap.includeScript(sBase + "/libs/pdfmake/vfs_fonts.js", "vfsFontsScript",
                        function () {
                            console.log("vfs_fonts loaded successfully.");
                            // sap.ui.core.BusyIndicator.hide();
                            if (typeof pdfMake === "undefined") {
                                that._busyDialog.close();
                                MessageBox.error("pdfMake library not loaded.\nEnsure pdfmake.min.js and vfs_fonts.js are in /webapp/libs/pdfmake/.");
                                return;
                            }
                            that._convertImgToBase64(sBase + "/model/BGL_logo.png", function (sB64Logo) {
                                that._generateCashReceiptPdf(aResults, sB64Logo);
                            });
                        },
                        function () {
                            // sap.ui.core.BusyIndicator.hide();
                            that._busyDialog.close();
                            MessageBox.error("Failed to load vfs_fonts.js. Check /webapp/libs/pdfmake/.");
                        }
                    );
                },
                function () {
                    // sap.ui.core.BusyIndicator.hide();
                    that._busyDialog.close();
                    MessageBox.error("Failed to load pdfmake.min.js. Check /webapp/libs/pdfmake/.");
                }
            );
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  IMAGE → BASE64
        // ═══════════════════════════════════════════════════════════════════════
        _convertImgToBase64: function (sUrl, fnCallback) {
            var oImg = new Image();
            oImg.crossOrigin = "Anonymous";
            oImg.onload = function () {
                var oCanvas = document.createElement("canvas");
                oCanvas.width = oImg.width; oCanvas.height = oImg.height;
                oCanvas.getContext("2d").drawImage(oImg, 0, 0);
                fnCallback(oCanvas.toDataURL("image/png"));
            };
            oImg.onerror = function () {
                console.warn("BGL logo not found – generating PDF without logo.");
                fnCallback(null);
            };
            oImg.src = sUrl;
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  DATE FORMATTER  →  DD/MM/YYYY
        //  Handles OData v2  /Date(ms)/  and ISO strings
        // ═══════════════════════════════════════════════════════════════════════
        _formatDate: function (vDate) {
            if (!vDate) { return ""; }
            var oDate;
            if (typeof vDate === "string" && vDate.indexOf("/Date(") === 0) {
                var ms = parseInt(vDate.replace(/\/Date\((\d+)\)\//, "$1"), 10);
                oDate = new Date(ms);
            } else {
                oDate = (vDate instanceof Date) ? vDate : new Date(vDate);
            }
            if (!oDate || isNaN(oDate.getTime())) { return String(vDate); }
            return String(oDate.getDate()).padStart(2, "0") + "/" +
                String(oDate.getMonth() + 1).padStart(2, "0") + "/" +
                oDate.getFullYear();
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  GENERATE BGL CASH RECEIPT PDF
        //
        //  Field mapping (ZI_PAYMENT_RECEIPTType + actual backend response):
        //  ─────────────────────────────────────────────────────────────────────
        //  PDF Label             │ OData Field
        //  ──────────────────────┼──────────────────────────────────────────
        //  Received From         │ customerName
        //  BP CODE               │ BPCode
        //  Issuing Location      │ ProfitCenterName
        //  RECEIPT NO            │ AccountingDocument
        //  DATE (header)         │ PostingDate  (/Date(ms)/)
        //  Transaction/CHQ NO    │ AccountingDocument
        //  Reference             │ Reference
        //  DATE (value date)     │ ValueDate  → fallback: PostingDate
        //  ₹ AMOUNT              │ Amount  (formatted en-IN)
        //  Rupees in words       │ computed from Amount
        //  Remarks               │ Remarks
        // ═══════════════════════════════════════════════════════════════════════
        _generateCashReceiptPdf: function (aResults, sBase64Logo) {
            var that = this;
            this._busyDialog.open();

            try {
                var fLine = function () { return 1; };
                var sBlack = "#000000";

                function cell(sText, oOpts) {
                    oOpts = oOpts || {};
                    return {
                        text: (sText !== null && sText !== undefined) ? String(sText) : "",
                        fontSize: oOpts.fontSize || 9,
                        bold: oOpts.bold || false,
                        alignment: oOpts.alignment || "left",
                        fillColor: oOpts.fillColor || null,
                        color: oOpts.color || sBlack,
                        colSpan: oOpts.colSpan || 1,
                        border: oOpts.border || [true, true, true, true],
                        margin: oOpts.margin || [4, 4, 4, 4],
                        italics: oOpts.italics || false
                    };
                }

                var aContent = [];

                aResults.forEach(function (oRow, iIdx) {

                    // ── Map OData fields to PDF labels ─────────────────────────
                    var sCustName = oRow.customerName || "-";
                    var sBPCode = oRow.BPCode || "-";
                    var sIssuingLoc = oRow.ProfitCenterName || "-";
                    var sReceiptNo = oRow.AccountingDocument || "-";
                    var sPostingDate = that._formatDate(oRow.PostingDate);
                    var sReference = oRow.Reference || "-";
                    // ValueDate can be null in backend → fall back to PostingDate
                    var sValueDate = oRow.ValueDate
                        ? that._formatDate(oRow.ValueDate)
                        : "-";
                    var fAmount = parseFloat(oRow.Amount || "0");
                    var sAmountFmt = fAmount.toLocaleString("en-IN", {
                        minimumFractionDigits: 2, maximumFractionDigits: 2
                    });
                    var sAmountWords = _amountToWords(fAmount);
                    var sRemarks = oRow.Remarks || "-";

                    if (iIdx > 0) { aContent.push({ text: "", pageBreak: "before" }); }

                    // ── BLOCK 1 : Company Header ───────────────────────────────
                    var aLogoRow;
                    if (sBase64Logo) {
                        aLogoRow = [
                            {
                                image: sBase64Logo, width: 55, height: 55,
                                alignment: "center", margin: [6, 4, 6, 4],
                                border: [true, true, false, true]
                            },
                            {
                                stack: [
                                    {
                                        text: "Bhagyanagar Gas Limited", bold: true, fontSize: 18,
                                        alignment: "center", color: "#1a3c6e", margin: [0, 8, 0, 2]
                                    },
                                    {
                                        text: "(A Joint venture of GAIL & HPCL)", fontSize: 9,
                                        alignment: "center", color: "#444444", margin: [0, 0, 0, 8]
                                    }
                                ], border: [false, true, true, true], margin: [0, 0, 0, 0]
                            }
                        ];
                    } else {
                        aLogoRow = [
                            {
                                stack: [
                                    {
                                        text: "Bhagyanagar Gas Limited", bold: true, fontSize: 18,
                                        alignment: "center", color: "#1a3c6e", margin: [0, 10, 0, 2]
                                    },
                                    {
                                        text: "(A Joint venture of GAIL & HPCL)", fontSize: 9,
                                        alignment: "center", color: "#444444", margin: [0, 0, 0, 8]
                                    }
                                ], colSpan: 2, border: [true, true, true, true], margin: [0, 0, 0, 0]
                            },
                            {}
                        ];
                    }
                    aContent.push({
                        table: { widths: [65, "*"], body: [aLogoRow] },
                        layout: {
                            hLineWidth: fLine, vLineWidth: fLine,
                            hLineColor: function () { return sBlack; },
                            vLineColor: function () { return sBlack; }
                        },
                        margin: [0, 0, 0, 0]
                    });

                    // ── BLOCK 2 : CASH RECEIPT title ──────────────────────────
                    aContent.push({
                        table: {
                            widths: ["*"], body: [[
                                {
                                    text: "CASH RECEIPT", fontSize: 13, bold: true,
                                    alignment: "center", margin: [0, 6, 0, 6],
                                    border: [true, false, true, true]
                                }
                            ]]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ── BLOCK 3 : Received From / BP Code / Issuing Loc / Receipt No / Date ──
                    aContent.push({
                        table: {
                            widths: ["26%", "16%", "22%", "20%", "16%"],
                            body: [
                                [
                                    cell("Received From", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("BP CODE", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("Issuing Location", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("RECEIPT NO", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("DATE", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" })
                                ],
                                [
                                    cell(sCustName, { fontSize: 9, alignment: "center" }),
                                    cell(sBPCode, { fontSize: 9, alignment: "center" }),
                                    cell(sIssuingLoc, { fontSize: 9, alignment: "center" }),
                                    cell(sReceiptNo, { fontSize: 9, alignment: "center", bold: false }),
                                    cell(sPostingDate, { fontSize: 9, alignment: "center" })
                                ]
                            ]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ── BLOCK 4 : Transaction / CHQ No | Reference | Date | Amount ──
                    aContent.push({
                        table: {
                            widths: ["34%", "33%", "33%"],
                            body: [
                                [
                                    cell("Transaction/CHQ NO", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    cell("DATE", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                    {
                                        text: "₹ AMOUNT", bold: true, fontSize: 8, alignment: "center",
                                        fillColor: "#f0f0f0", border: [true, true, true, true], margin: [4, 4, 4, 4]
                                    }
                                ],
                                [
                                    cell(sReference, { fontSize: 9, alignment: "center" }),
                                    cell(sValueDate, { fontSize: 9, alignment: "center" }),
                                    cell(sAmountFmt, { fontSize: 9, alignment: "right", bold: true })
                                ]
                            ]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ── BLOCK 5 : Rupees in Words ──────────────────────────────
                    aContent.push({
                        table: {
                            widths: ["*"], body: [
                                [{
                                    text: "RUPEES (IN WORDS)", bold: true, fontSize: 8,
                                    alignment: "center", fillColor: "#f0f0f0",
                                    margin: [0, 4, 0, 2], border: [true, false, true, true]   // Left,Top,Right,Bottom
                                }],
                                [{
                                    text: sAmountWords, fontSize: 9, alignment: "center",
                                    margin: [4, 5, 4, 5], border: [true, false, true, true]
                                }]
                            ]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ── BLOCK 6 : Remarks ──────────────────────────────────────
                    aContent.push({
                        table: {
                            widths: ["*"], body: [
                                [{
                                    text: "REMARKS", bold: true, fontSize: 8,
                                    alignment: "center", fillColor: "#f0f0f0",
                                    margin: [0, 4, 0, 2], border: [true, false, true, true]
                                }],
                                [{
                                    text: sRemarks || " ", fontSize: 9, alignment: "center",
                                    margin: [4, 6, 4, 30], border: [true, false, true, true]
                                }]
                            ]
                        },
                        layout: { hLineWidth: fLine, vLineWidth: fLine },
                        margin: [0, 0, 0, 0]
                    });

                    // ── BLOCK 7 : Footer note ──────────────────────────────────
                    aContent.push({
                        text: "* This is a system generated receipt no signature is required",
                        fontSize: 8, italics: true, color: "#555555", margin: [2, 10, 0, 0]
                    });

                }); // end forEach

                var oDocDef = {
                    pageSize: "A4", pageMargins: [30, 30, 30, 30],
                    content: aContent, defaultStyle: { fontSize: 9 }
                };

                pdfMake.createPdf(oDocDef).getBlob(function (oBlob) {
                    if (that._pdfBlobUrl) { URL.revokeObjectURL(that._pdfBlobUrl); }
                    var sBlobUrl = URL.createObjectURL(oBlob);
                    that._pdfBlobUrl = sBlobUrl;

                    that.byId("pdfIframeContainer").setContent(
                        // '<div style="width:100%;height:calc(100vh - 100px);">' +
                        // '<iframe src="' + sBlobUrl + '" ' +
                        // 'style="width:100%;height:100%;border:none;" frameborder="0">' +
                        // '</iframe>' +
                        // '</div>'
                        `
                            <div class="pdf-iframe-container">
                                <iframe src="${sBlobUrl}" class="pdf-iframe"></iframe>
                            </div>
                        `
                    );
                    that._busyDialog.close();
                });

            } catch (oErr) {
                console.error("PDF generation failed:", oErr);
                this._busyDialog.close();
                MessageBox.error("Failed to generate Cash Receipt PDF.\nError: " + oErr.message);
            }
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  GENERATE BGL CASH RECEIPT PDF FOR MULTIPLE LINE_ITEMS
        //
        //  All rows in aResults belong to the SAME document (same parameterized
        //  fetch). Header blocks (1–3, 6–7) use aResults[0].
        //  Block 4 renders ONE data row per result item.
        //  Block 5 (Rupees in Words) shows the SUM of all line item amounts.
        // ═══════════════════════════════════════════════════════════════════════
        _generateCashReceiptPdf22222: function (aResults, sBase64Logo) {
            var that = this;

            try {
                var fLine = function () { return 1; };
                var sBlack = "#000000";

                function cell(sText, oOpts) {
                    oOpts = oOpts || {};
                    return {
                        text: (sText !== null && sText !== undefined) ? String(sText) : "",
                        fontSize: oOpts.fontSize || 9,
                        bold: oOpts.bold || false,
                        alignment: oOpts.alignment || "left",
                        fillColor: oOpts.fillColor || null,
                        color: oOpts.color || sBlack,
                        colSpan: oOpts.colSpan || 1,
                        border: oOpts.border || [true, true, true, true],
                        margin: oOpts.margin || [4, 4, 4, 4],
                        italics: oOpts.italics || false
                    };
                }

                // ── Header fields come from the first row (same for all rows) ──
                var oHdr = aResults[0];
                var sCustName = oHdr.customerName || "-";
                var sBPCode = oHdr.BPCode || "-";
                var sIssuingLoc = oHdr.ProfitCenterName || "-";
                var sReceiptNo = oHdr.AccountingDocument || "-";
                var sPostingDate = that._formatDate(oHdr.PostingDate);
                var sRemarks = oHdr.Remarks || "-";

                // ── Sum all line item amounts for Block 5 ──────────────────────
                var fTotalAmount = 0;
                aResults.forEach(function (oRow) {
                    fTotalAmount += parseFloat(oRow.Amount || "0");
                });
                var sTotalAmountFmt = fTotalAmount.toLocaleString("en-IN", {
                    minimumFractionDigits: 2, maximumFractionDigits: 2
                });
                var sTotalAmountWords = _amountToWords(fTotalAmount);

                var aContent = [];

                // ── BLOCK 1 : Company Header ───────────────────────────────────
                var aLogoRow;
                if (sBase64Logo) {
                    aLogoRow = [
                        {
                            image: sBase64Logo, width: 55, height: 55,
                            alignment: "center", margin: [6, 4, 6, 4],
                            border: [true, true, false, true]
                        },
                        {
                            stack: [
                                {
                                    text: "Bhagyanagar Gas Limited", bold: true, fontSize: 18,
                                    alignment: "center", color: "#1a3c6e", margin: [0, 8, 0, 2]
                                },
                                {
                                    text: "(A Joint venture of GAIL & HPCL)", fontSize: 9,
                                    alignment: "center", color: "#444444", margin: [0, 0, 0, 8]
                                }
                            ], border: [false, true, true, true], margin: [0, 0, 0, 0]
                        }
                    ];
                } else {
                    aLogoRow = [
                        {
                            stack: [
                                {
                                    text: "Bhagyanagar Gas Limited", bold: true, fontSize: 18,
                                    alignment: "center", color: "#1a3c6e", margin: [0, 10, 0, 2]
                                },
                                {
                                    text: "(A Joint venture of GAIL & HPCL)", fontSize: 9,
                                    alignment: "center", color: "#444444", margin: [0, 0, 0, 8]
                                }
                            ], colSpan: 2, border: [true, true, true, true], margin: [0, 0, 0, 0]
                        },
                        {}
                    ];
                }
                aContent.push({
                    table: { widths: [65, "*"], body: [aLogoRow] },
                    layout: {
                        hLineWidth: fLine, vLineWidth: fLine,
                        hLineColor: function () { return sBlack; },
                        vLineColor: function () { return sBlack; }
                    },
                    margin: [0, 0, 0, 0]
                });

                // ── BLOCK 2 : CASH RECEIPT title ──────────────────────────────
                aContent.push({
                    table: {
                        widths: ["*"], body: [[
                            {
                                text: "CASH RECEIPT", fontSize: 13, bold: true,
                                alignment: "center", margin: [0, 6, 0, 6],
                                border: [true, false, true, true]
                            }
                        ]]
                    },
                    layout: { hLineWidth: fLine, vLineWidth: fLine },
                    margin: [0, 0, 0, 0]
                });

                // ── BLOCK 3 : Received From / BP Code / Issuing Loc / Receipt No / Date ──
                aContent.push({
                    table: {
                        widths: ["26%", "16%", "22%", "20%", "16%"],
                        body: [
                            [
                                cell("Received From", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                cell("BP CODE", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                cell("Issuing\nLocation", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                cell("RECEIPT\nNO", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                                cell("DATE", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" })
                            ],
                            [
                                cell(sCustName, { fontSize: 9, alignment: "center" }),
                                cell(sBPCode, { fontSize: 9, alignment: "center" }),
                                cell(sIssuingLoc, { fontSize: 9, alignment: "center" }),
                                cell(sReceiptNo, { fontSize: 9, alignment: "center" }),
                                cell(sPostingDate, { fontSize: 9, alignment: "center" })
                            ]
                        ]
                    },
                    layout: { hLineWidth: fLine, vLineWidth: fLine },
                    margin: [0, 0, 0, 0]
                });

                // ── BLOCK 4 : Transaction lines  (one row per result item) ─────
                // Header row is fixed; data rows loop over all aResults.
                var aLineRows = [
                    // Header row
                    [
                        cell("Transaction/\nCHQ NO", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                        cell("DATE", { bold: true, fontSize: 8, alignment: "center", fillColor: "#f0f0f0" }),
                        {
                            text: "₹ AMOUNT", bold: true, fontSize: 8, alignment: "center",
                            fillColor: "#f0f0f0", border: [true, true, true, true], margin: [4, 4, 4, 4]
                        }
                    ]
                ];

                aResults.forEach(function (oRow) {
                    var sRef = oRow.Reference || "-";
                    // ValueDate null → show "-"
                    var sVD = oRow.ValueDate ? that._formatDate(oRow.ValueDate) : "-";
                    var fAmt = parseFloat(oRow.Amount || "0");
                    var sAmt = fAmt.toLocaleString("en-IN", {
                        minimumFractionDigits: 2, maximumFractionDigits: 2
                    });

                    aLineRows.push([
                        cell(sRef, { fontSize: 9, alignment: "center" }),
                        cell(sVD, { fontSize: 9, alignment: "center" }),
                        cell(sAmt, { fontSize: 9, alignment: "right", bold: true })
                    ]);
                });

                aContent.push({
                    table: {
                        widths: ["34%", "33%", "33%"],
                        body: aLineRows
                    },
                    layout: { hLineWidth: fLine, vLineWidth: fLine },
                    margin: [0, 0, 0, 0]
                });

                // ── BLOCK 5 : Rupees in Words  (SUM of all line amounts) ───────
                aContent.push({
                    table: {
                        widths: ["*"], body: [
                            [{
                                text: "RUPEES\n(IN WORDS)", bold: true, fontSize: 8,
                                alignment: "center", fillColor: "#f0f0f0",
                                margin: [0, 4, 0, 2], border: [true, false, true, true]
                            }],
                            [{
                                text: sTotalAmountWords, fontSize: 9, alignment: "center",
                                margin: [4, 5, 4, 5], border: [true, false, true, true]
                            }]
                        ]
                    },
                    layout: { hLineWidth: fLine, vLineWidth: fLine },
                    margin: [0, 0, 0, 0]
                });

                // ── BLOCK 6 : Remarks ──────────────────────────────────────────
                aContent.push({
                    table: {
                        widths: ["*"], body: [
                            [{
                                text: "REMARKS", bold: true, fontSize: 8,
                                alignment: "center", fillColor: "#f0f0f0",
                                margin: [0, 4, 0, 2], border: [true, false, true, true]
                            }],
                            [{
                                text: sRemarks, fontSize: 9, alignment: "center",
                                margin: [4, 6, 4, 30], border: [true, false, true, true]
                            }]
                        ]
                    },
                    layout: { hLineWidth: fLine, vLineWidth: fLine },
                    margin: [0, 0, 0, 0]
                });

                // ── BLOCK 7 : Footer note ──────────────────────────────────────
                aContent.push({
                    text: "* This is a system generated receipt no signature is required",
                    fontSize: 8, italics: true, color: "#555555", margin: [2, 10, 0, 0]
                });

                // ── Render ─────────────────────────────────────────────────────
                var oDocDef = {
                    pageSize: "A4", pageMargins: [30, 30, 30, 30],
                    content: aContent, defaultStyle: { fontSize: 9 }
                };

                pdfMake.createPdf(oDocDef).getBlob(function (oBlob) {
                    if (that._pdfBlobUrl) { URL.revokeObjectURL(that._pdfBlobUrl); }
                    var sBlobUrl = URL.createObjectURL(oBlob);
                    that._pdfBlobUrl = sBlobUrl;

                    that.byId("pdfIframeContainer").setContent(
                        `<div class="pdf-iframe-container">
                            <iframe src="${sBlobUrl}" class="pdf-iframe"></iframe>
                        </div>`
                    );
                    that._busyDialog.close();
                });

            } catch (oErr) {
                console.error("PDF generation failed:", oErr);
                this._busyDialog.close();
                MessageBox.error("Failed to generate Cash Receipt PDF.\nError: " + oErr.message);
            }
        },


        // ═══════════════════════════════════════════════════════════════════════
        //  PDF PLACEHOLDER
        // ═══════════════════════════════════════════════════════════════════════
        _setPdfPlaceholder: function () {
            var oHtml = this.byId("pdfIframeContainer");
            if (!oHtml) { return; }
            oHtml.setContent(
                '<div style="height:calc(100vh - 255px);display:flex;align-items:center;' +
                'justify-content:center;flex-direction:column;color:#888;' +
                'font-family:Arial,sans-serif;text-align:center;' +
                'border:2px dashed #ccc;border-radius:8px;background:#fafafa;">' +
                '<div style="font-size:3rem;margin-bottom:12px;">🧾</div>' +
                '<h3 style="margin:0 0 8px 0;color:#555;">No Receipt Generated</h3>' +
                '<p style="margin:0;color:#999;">Enter <b>Document No</b> and <b>Fiscal Year</b>, ' +
                'then click <b>Go</b>.</p>' +
                '</div>'
            );
        },

        _resetPdfArea: function () {
            this._setPdfPlaceholder();
            if (this._pdfBlobUrl) { URL.revokeObjectURL(this._pdfBlobUrl); this._pdfBlobUrl = null; }
        },

        // ═══════════════════════════════════════════════════════════════════════
        //  FLOATING BUTTON HANDLERS
        // ═══════════════════════════════════════════════════════════════════════
        onDownloadPdf: function () {
            if (!this._pdfBlobUrl) {
                MessageToast.show("No PDF generated yet. Please click Go first.");
                return;
            }
            var oWin = window.open("", "_blank");
            if (!oWin) { MessageToast.show("Please allow pop-ups to open the PDF."); return; }
            oWin.document.write(
                "<html><head><title>BGL Cash Receipt</title>" +
                "<style>html,body{margin:0;height:100%;overflow:hidden;}" +
                "iframe{width:100%;height:100%;border:none;}</style></head>" +
                "<body><iframe src=\"" + this._pdfBlobUrl + "\" allow=\"fullscreen\"></iframe></body></html>"
            );
            oWin.document.close();
        },

        onClosePdfPreview: function () {
            // Reset Document No
            this.byId("idDocumentNoInput")
                .setValue("")
                .setValueState(sap.ui.core.ValueState.None)
                .setValueStateText("");

            // Reset DatePicker – clear model property and value state
            this.getView().getModel().setProperty("/valueDP11", null);
            this.byId("idFiscalYearDP")
                .setValueState(sap.ui.core.ValueState.None)
                .setValueStateText("");

            this._resetPdfArea();
        }

    }); // end Controller.extend
}); // end sap.ui.define