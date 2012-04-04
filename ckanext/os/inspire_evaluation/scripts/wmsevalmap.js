// Name				: wmsevalmap.js 
// Description      : JavaScript file for the INSPIRE / UKLP evaluation map widget (evalmapwms.htm)
// Author			: Peter Cotroneo, Ordnance Survey, Andrew Bailey (C)
// Version			: 2.3.0.3
// Notes			: This version does not turn layers off automatically after receiving an image load error
//					: On deployment: change UKLP_HELP_DOCUMENTATION to suit DGU href

var tree, mapPanel, map, xmlHttp, leftPanel;
var urls, reachableUrls, unreachableUrls;
var intervalID, bBoxErr;
var gwcLayer;
var bBox;                                         // array to store the parsed parameters
var mapBounds;                                     // OpenLayers.Bounds of the parsed parameters
var mapExtent;                                     // OpenLayers.Bounds transformed to correct projection
var boxes;                                         // OpenLayers.Layer to store area of interest
var redBox;                                     // OpenLayers.Marker to store area of interest
var borderColor;                                
var clickControl;                                // OpenLayers.WMSGetFeatureInfo Control to handle get feature info requests
var loadingPanel;                                // OpenLayers.Control.LoadingPanel to handle loading information
var myLayerURLs;                                // array to store URLs against each external map layer
var myLayers;                                    // array to store external map layers in map
var paramsParsed;                                // object that holds bounding box, urls and info Format / Exceptions format for testing

/*
 * Projection definitions
 */
Proj4js.defs["EPSG:4258"] = "+proj=longlat +ellps=GRS80 +no_defs";
Proj4js.defs["EPSG:27700"] = "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs";
Proj4js.defs["EPSG:29903"] = "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 +x_0=200000 +y_0=250000 +a=6377340.189 +b=6356034.447938534 +units=m +no_defs";
Proj4js.defs["EPSG:2157"] = "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
Proj4js.defs["EPSG:4326"] = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs";

/* Tell OpenLayers which projections need reverseAxisOrder in WMS 1.3 */ 
OpenLayers.Layer.WMS.prototype.yx["EPSG:4258"] = true;

/* Provide a more informative default image for failed legendUrl requests */ 
//GeoExt.LegendImage.prototype.defaultImgSrc = "http://46.137.180.108/images/no_legend.png";

Ext.QuickTips.init();

Ext.onReady(function(){

    OSInspire = {};
    
    OSInspire.Layer = {};
    
    OSInspire.Layer.WMS = OpenLayers.Class(OpenLayers.Layer.WMS, {    
        getURL: function(bounds){       
            bounds = this.adjustBounds(bounds);            
            var imageSize = this.getImageSize();            
            var newParams = {};            
            // WMS 1.3 introduced axis order            
            var reverseAxisOrder = this.reverseAxisOrder();            
            newParams.BBOX = this.encodeBBOX ? bounds.toBBOX(null, reverseAxisOrder) : bounds.toArray(reverseAxisOrder);            
            newParams.WIDTH = imageSize.w;            
            newParams.HEIGHT = imageSize.h;            
            newParams.LAYERS = this.layerNames[this.map.zoom];            
            var requestString = this.getFullRequestString(newParams);            
            return requestString;            
        },        
        CLASS_NAME: "OSInspire.Layer.WMS"    
    });
    
    OSInspire.WMSGetFeatureInfo = OpenLayers.Class(OpenLayers.Format.WMSGetFeatureInfo, {
        read : function(data){
            if (typeof data == "object") {
                // possibly XML document
                if (data.doctype)
                {
                    // potentially to be an html doc disguised as xml
                    if (data.doctype.name)
                    {
                        switch (data.doctype.name) 
                        {
                            case "html":
                                features = [new OpenLayers.Feature.Vector(null,{rawInfo:XMLtoString(data)})];   //
                                break;
                            default:
                                features = OpenLayers.Format.WMSGetFeatureInfo.prototype.read.call(this,data);
                        }                       
                    } else {
                        // process as xml
                        features = OpenLayers.Format.WMSGetFeatureInfo.prototype.read.call(this,data);
                    }
                } else {
                    // process as xml
                    features = OpenLayers.Format.WMSGetFeatureInfo.prototype.read.call(this,data);
                }
            } else {
                // not an XML document, but it might be an XML string. Attempt to process as XML first
                if (typeof data == "string") {
                    features = OpenLayers.Format.WMSGetFeatureInfo.prototype.read.call(this,data);
                    if(!features.length){
                       features = [new OpenLayers.Feature.Vector(null,{rawInfo:data})];    
                    }
                }
            }
            return features;
        },
        CLASS_NAME: "OSInspire.WMSGetFeatureInfo"
    });
    
    OpenLayers.Control.LoadingPanel = OpenLayers.Class(OpenLayers.Control, {

        /**
         * Property: counter
         * {Integer} A counter for the number of layers loading
         */ 
        counter: 0,

        /**
         * Property: maximized
         * {Boolean} A boolean indicating whether or not the control is maximized
        */
        maximized: false,

        /**
         * Property: visible
         * {Boolean} A boolean indicating whether or not the control is visible
        */
        visible: true,

        /**
         * Constructor: OpenLayers.Control.LoadingPanel
         * Display a panel across the map that says 'loading'. 
         *
         * Parameters:
         * options - {Object} additional options.
         */
        initialize: function(options) {
             OpenLayers.Control.prototype.initialize.apply(this, [options]);
        },

        /**
         * Function: setVisible
         * Set the visibility of this control
         *
         * Parameters:
         * visible - {Boolean} should the control be visible or not?
        */
        setVisible: function(visible) {
            this.visible = visible;
            if (visible) {
                OpenLayers.Element.show(this.div);
            } else {
                OpenLayers.Element.hide(this.div);
            }
        },

        getWaitText: function() {
            //return ("Waiting for") + ' ' + this.counter + ' ' + (this.counter <= 1 ? ('map service to load.') : ('map services to load.'));
            //console.log("waiting for " + this.counter);
            return ("Waiting for map services to load.");            
        },
        
        /**
         * Function: getVisible
         * Get the visibility of this control
         *
         * Returns:
         * {Boolean} the current visibility of this control
        */
        getVisible: function() {
            return this.visible;
        },

        /**
         * APIMethod: hide
         * Hide the loading panel control
        */
        hide: function() {
            this.setVisible(false);
        },

        /**
         * APIMethod: show
         * Show the loading panel control
        */
        show: function() {
            this.setVisible(true);
        },

        /**
         * APIMethod: toggle
         * Toggle the visibility of the loading panel control
        */
        toggle: function() {
            this.setVisible(!this.getVisible());
        },

        /**
         * Method: addLayer
         * Attach event handlers when new layer gets added to the map
         *
         * Parameters:
         * evt - {Event}
        */
        addLayer: function(evt) {
            if (evt.layer) {
                evt.layer.events.register('loadstart', this, this.increaseCounter);
                evt.layer.events.register('loadend', this, this.decreaseCounter);
            }
        },

        /**
         * Method: setMap
         * Set the map property for the control and all handlers.
         *
         * Parameters: 
         * map - {<OpenLayers.Map>} The control's map.
         */
        setMap: function(map) {
            OpenLayers.Control.prototype.setMap.apply(this, arguments);
            this.map.events.register('preaddlayer', this, this.addLayer);
            for (var i = 0; i < this.map.layers.length; i++) {
                var layer = this.map.layers[i];
                layer.events.register('loadstart', this, this.increaseCounter);
                layer.events.register('loadend', this, this.decreaseCounter);
            }
        },

        /**
         * Method: increaseCounter
         * Increase the counter and show control
        */
        increaseCounter: function() {
            this.counter++;
            if (this.counter > 0) { 
                this.div.innerHTML = this.getWaitText();
                if (!this.maximized && this.visible) {
                    this.maximizeControl(); 
                }
            }
        },
        
        /**
         * Method: decreaseCounter
         * Decrease the counter and hide the control if finished
        */
        decreaseCounter: function() {
            if (this.counter > 0) {
                this.div.innerHTML = this.getWaitText();
                this.counter--;
            }
            if (this.counter == 0) {
                if (this.maximized && this.visible) {
                    this.minimizeControl();
                }
            }
        },

        /**
         * Method: draw
         * Create and return the element to be splashed over the map.
         */
        draw: function () {
            OpenLayers.Control.prototype.draw.apply(this, arguments);
            return this.div;
        },
         
        /**
         * Method: minimizeControl
         * Set the display properties of the control to make it disappear.
         *
         * Parameters:
         * evt - {Event}
         */
        minimizeControl: function(evt) {
            this.div.style.display = "none"; 
            this.maximized = false;
        
            if (evt != null) {
                OpenLayers.Event.stop(evt);
            }
        },
        
        /**
         * Method: maximizeControl
         * Make the control visible.
         *
         * Parameters:
         * evt - {Event}
         */
        maximizeControl: function(evt) {
            this.div.style.display = "block";
            this.maximized = true;
        
            if (evt != null) {
                OpenLayers.Event.stop(evt);
            }
        },

        /** 
         * Method: destroy
         * Destroy control.
         */
        destroy: function() {
            if (this.map) {
                this.map.events.unregister('preaddlayer', this, this.addLayer);
                if (this.map.layers) {
                    for (var i = 0; i < this.map.layers.length; i++) {
                        var layer = this.map.layers[i];
                        layer.events.unregister('loadstart', this, 
                            this.increaseCounter);
                        layer.events.unregister('loadend', this, 
                            this.decreaseCounter);
                    }
                }
            }
            OpenLayers.Control.prototype.destroy.apply(this, arguments);
        },     

        CLASS_NAME: "OpenLayers.Control.LoadingPanel"

    });
    
    OpenLayers.DOTS_PER_INCH = 90.71428571428572;

    OpenLayers.ProxyHost = "preview_getinfo?url=";
    
    OpenLayers.Util.onImageLoadError = function(){
    
        //now defunct OpenLayers.Util.onImageLoadError
        
        // this.src provides the wms request
        var errorStr = this.src.substring(0, (this.src.indexOf("?") + 1));
        var childStr = "";
        
        var foundBadWMS = false;
        var root = tree.getRootNode();
        var children = root.childNodes;
        
        if (!(foundBadWMS)) {
            // src may be returning with a different sub-domain but the same parent domain/hostname
            errorStr = getHostname(this.src);
            var count = errorStr.split(".");
            if (count.length > 2) {
                // www.xxx.com counts the same as yyy.xxx.com
                var parentDomain = errorStr.substring((errorStr.indexOf(".") + 1), errorStr.length);
                for (var j = 0; j < children.length; j++) {
                    parentDomainOfNode = getHostname(children[j].text);
                    parentDomainOfNode = parentDomainOfNode.substring((parentDomainOfNode.indexOf(".") + 1), parentDomainOfNode.length);
                    if (parentDomain == parentDomainOfNode) {
                        Ext.MessageBox.alert('Error', ("The WMS source: " + children[j].text + " has failed to load - please switch it off or try a different projection."));
                        //children[j].cascade(function(m){
                            // var ui2 = m.getUI();
                            // ui2.toggleCheck(false);
                        // });
                        foundBadWMS = true;
                    }
                }
            }
        }
    }
    
    var options = {
        projection: "EPSG:4258",
        units: 'degrees',
        maxExtent: new OpenLayers.Bounds(-30, 48.00, 3.50, 64.00),
        displayProjection: new OpenLayers.Projection("EPSG:4326"),
        scales: [15000000, 10000000, 5000000, 1000000, 250000, 75000, 50000, 25000, 10000, 5000, 2500,1000],    
        restrictedExtent: new OpenLayers.Bounds(-30, 48.00, 3.50, 64.00),
        tileSize: new OpenLayers.Size(250, 250)
    };
    
    copyrightStatements = "Contains Ordnance Survey data (c) Crown copyright and database right [2012].<br>" +
    "Contains Royal Mail data (c) Royal Mail copyright and database right [2012]<br>" +
    "Contains bathymetry data by GEBCO (c) Copyright [2012].<br>" +
    "Contains data by Land & Property Services (Northern Ireland) (c) Crown copyright [2012]";
    
    tiled = new OpenLayers.Layer.WMS("OS Base Mapping", "http://osinspiremappingprod.ordnancesurvey.co.uk/geoserver/gwc/service/wms", {
        LAYERS: 'InspireETRS89',
        styles: '',
        format: 'image/png',
        tiled: true
    }, {
        buffer: 0,
        displayOutsideMaxExtent: true,
        isBaseLayer: true,
        attribution: copyrightStatements,
        transitionEffect: 'resize',
        queryable: false
    });
    
    var wmsParams = {
        format: 'image/png'
    };
    
    var wmsOptions = {
        buffer: 0,
        attribution: copyrightStatements
    };
    
    map = new OpenLayers.Map("mappanel", options);
    
    map.events.on({
        "zoomend": function(e){
            if (tiled.getVisibility()) {
                tiled.redraw();
            }
        }
    });    
    map.events.on({
        "moveend": function(e){
            //loadingPanel.moveend();
            // loadingPanel = new OpenLayers.Control.LoadingPanel();
            // map.addControl(loadingPanel);
        }
    });
    
    // The OpenLayers.Control.Click object is used as a workaround to a known bug in OpenLayers
    // Right-click on map and left-click can stop working
    // We use a click control to grab the right-click and bump the getFeatureInfo control into life
    OpenLayers.Control.Click = OpenLayers.Class(OpenLayers.Control, {                
        defaultHandlerOptions: {
            'single': true,
            'double': true,
            'pixelTolerance': null,
            'stopSingle': false,
            'stopDouble': false
        },
        handleRightClicks:true,
        initialize: function(options) {
            this.handlerOptions = OpenLayers.Util.extend(
                {}, this.defaultHandlerOptions
            );
            OpenLayers.Control.prototype.initialize.apply(this, arguments); 
            this.handler = new OpenLayers.Handler.Click(
                this, this.eventMethods, this.handlerOptions
            );
        },
        CLASS_NAME: "OpenLayers.Control.Click"
    });
    // Add an instance of the Click control that listens to various click events:
    var oClick = new OpenLayers.Control.Click({eventMethods:{
        'rightclick': function(e) {
            clickControl.deactivate();
            clickControl.activate();
            //alert('rightclick at '+e.xy.x+','+e.xy.y);
        },
        'click': function(e) {
            //alert('click at '+e.xy.x+','+e.xy.y);
        },
        'dblclick': function(e) {
            //alert('dblclick at '+e.xy.x+','+e.xy.y);
        },
        'dblrightclick': function(e) {
            //alert('dblrightclick at '+e.xy.x+','+e.xy.y);
        }
    }});    
    map.addControl(oClick);
    oClick.activate();    
    
    // XMLtoString - handling of getFeatureInfo responses
    function XMLtoString(elem){
        // used by clickControlFormat when receiving an html file that's recognised as an XML Document
        var serialized;    
        try {
            // XMLSerializer exists in current Mozilla browsers
            serializer = new XMLSerializer();
            serialized = serializer.serializeToString(elem);
        } 
        catch (e) {
            // Internet Explorer has a different approach to serializing XML
            serialized = elem.xml;
        }    
        return serialized;
    }
    
    // handling of getFeatureInfo responses
    function boolCheckForHTMLContent(strHTML){
        // used by clickControl for HTML responses 
        var boolContent = false;
        var boolWithinBrackets = false;
        var strippedHTML = strHTML.replace(/(\r\n|\n|\r)/gm,"");
        
        // need to remove everything before <body>
        //var indexOfBody = strippedHTML.indexOf(">", strippedHTML.indexOf("<body"));
        //strippedHTML = strippedHTML.substring(indexOfBody + 1, strippedHTML.length + 1);
        
        strippedHTML = strippedHTML.substring(strippedHTML.indexOf("<body"), strippedHTML.length + 1);
        
        for (i = 0; i < strippedHTML.length -1; i++)
        {
            if ((alphaNumericCheck(strippedHTML.charAt(i))) && (!boolWithinBrackets)){
                boolContent = true;
            }            
            if (strippedHTML.charAt(i) == "<") {
                boolWithinBrackets = true;
            }
            if (strippedHTML.charAt(i) == ">") {
                boolWithinBrackets = false;
            }
        }
        return boolContent;
    }
    
    // handling of getFeatureInfo responses
    function alphaNumericCheck(theChar) {
        // used by boolCheckForHTMLContent
        var cc = theChar.charCodeAt(0);
        if((cc>47 && cc<58) || (cc>64 && cc<91) || (cc>96 && cc<123))
        {
            return true;
        } else {         
            return false;
        }
    }

    // format control for WMSGetFeatureInfo requests    
    var clickControlFormat = new OSInspire.WMSGetFeatureInfo();
        
    var colModel = new Ext.grid.ColumnModel([
        {header: "Name", width:50, sortable: true, dataIndex:'name', id: 'name', menuDisabled:true},
        {header: "Value", width:500, resizable:true, dataIndex: 'value', id: 'value', menuDisabled:true,
            renderer : function(value, metadata, record) {
                return "<p style=\"white-space: normal;word-wrap:break-word;\">" + value + "</p>";
        }}
     ]);
         
    clickControl = new OpenLayers.Control.WMSGetFeatureInfo({
        drillDown: true,
        autoActivate: true,        
        maxFeatures: 11,
        output: 'features', // object or features
        format: clickControlFormat,
        layers: [],
        handlerOptions: {
            "click": {delay: 1000}
        },
        eventListeners: {
            
            nogetfeatureinfo: function(e) {
                Ext.MessageBox.alert('Feature Information', 'A layer must be selected before information can be retrieved.', '');            
            },
            
            getfeatureinfo: function(e) {
                if (!(Ext.isEmpty(Ext.getCmp('popup'))))
                {
                    popup.close();
                }
                var items = [];
                var propertyGridCount = 0;                
                for (i = 0; i < e.features.length; i++)
                {
                    if (i < 10) {
                        if (e.features[i].data.rawInfo)
                        {
                            // probably html / text response
                            var content = e.features[i].data.rawInfo;
                            if (!(boolCheckForHTMLContent(content))) {
                                content = "No features found.";
                            }
                            items.push({
                                xtype: "panel",
                                title: "Layer response",
                                html: content,
                                autoScroll: true
                            });
                        } 
                        else 
                        {                    
                            var layerName = "";
                            if (e.features[i].type) {
                                layerName = ": " + e.features[i].type;
                                layerName = layerName.replaceAll("."," ");
                                layerName = layerName.replaceAll("_"," ");
                            }
                            propertyGridCount++;
                            // Use html version with panel
                            items.push({
                                xtype: "panel",
                                title: "Feature " + propertyGridCount + layerName,
                                html: featuresAttributestoHTMLTable(e.features[i]),
                                autoScroll: true
                            });
                            // Use xml version with propertygrid
                            
                            // var grid2 = new xg.Grid3({
                                // source: e.features[i].attributes,
                                // cm: colModel,
                                // title: "Feature " + propertyGridCount + layerName
                            // });

                            
                            // items.push({
                                // xtype: "propertygrid",
                                // title: "Feature " + propertyGridCount + layerName,
                                // stripeRows: true,
                                // source: e.features[i].attributes,
                                // autoScroll: true,
                                // colModel: colModel                                
                                // // width: 600,
                                // // height: 800,
                                // // autoHeight: false
                            // });
                            
                            // items.push({
                                // xtype: "grid",
                                // title: "Feature " + propertyGridCount + layerName,
                                // //stripeRows: true,
                                // source: e.features[i].attributes,
                                // autoScroll: true,
                                // colModel: colModel                                
                                // // width: 600,
                                // // height: 800,
                                // // autoHeight: false
                            // });
                        }        
                    }
                    if ((i == 10) && (e.features.length > 10))
                    {
                        items.push({
                            xtype: "panel",
                            title: "Other responses",
                            html: "Information is limited to 10 features. Please zoom in or reduce the number of layers that are visible.",
                            autoScroll: true
                        });
                    }
                }                
                // check for ServiceException
                if (e.text != null)
                {
                    if (e.text.toLowerCase().indexOf("serviceexception") > -1)
                    {
                        var seXMLDoc = StringtoXML(e.text);
                        var dq = Ext.DomQuery; 
                        var node = dq.selectNode('ServiceException', seXMLDoc);  
                        items.push({
                            xtype: "panel",
                            title: "Layer response",
                            html: node.textContent,
                            autoScroll: true
                        });
                    }
                }
                
                // calculating the anchor point for the popup
                var mapCentre = mapPanel.map.getCenter();
                // determine height required for popUp. There's a limit of 10 features + 1 warning of too many features = 11
                var popUpHeight;
                var featuresCount = e.features.length;
                if (featuresCount > 10) {
                    featuresCount = 11;
                }
                popUpHeight = (featuresCount * 25) + 105;
                if (popUpHeight < 300)
                {
                    popUpHeight = 300;
                }
                var popUpWidth = 400; 
                // the following provides the bottom-left latlon point for the popup. no idea why it doesn't need -((popUpWidth/2)*mapPanel.map.getResolution()) on the lat but it works.
                var popUpAnchor = new OpenLayers.LonLat((mapCentre.lon),(mapCentre.lat-((popUpHeight/2)*mapPanel.map.getResolution())));
                
                popup = new Ext.Window({
                    id: 'popup',
                    title: "Feature Information",
                    resizable: true,
                    width:popUpWidth,
                    height:popUpHeight,
                    minWidth: 400,
                    //minHeight: 300,
                    boxMaxWidth: 600,
                    //boxMaxHeight: 800,
                    layout: "accordion",
                    draggable: true,
                    //autoScroll: true,
                    constrain: true,
                    items: items
                });
                
                if (items.length == 0)
                {
                    popup.html = 'No features found.'; 
                    popup.minWidth = 400;
                    popup.width = 400;
                    popup.minHeight = 300;
                    popup.height = 300;
                }
                
                popup.show();
                OpenLayers.Element.removeClass(this.map.viewPortDiv, "olCursorWait");
                window.status="";
            }
        }
    });    
    
    map.addControl(clickControl);
    
    // Remove default PanZoom bar; will use zoom slider below 
    var ccControl = map.getControlsByClass("OpenLayers.Control.PanZoom");
    map.removeControl(ccControl[0]);
    
    // Add scale bar
    map.addControl(new OpenLayers.Control.ScaleLine({
        geodesic: false
    }));
    
    // keyboard control
    map.addControl(new OpenLayers.Control.KeyboardDefaults({
        autoActivate: true
        //observeElement: "mappanel"
    }));
    
    // Add mouse position.  
    function formatLonlats(lonLat){
        var lat = lonLat.lat;
        var lon = lonLat.lon;
        var ns = OpenLayers.Util.getFormattedLonLat(lat);
        var ew = OpenLayers.Util.getFormattedLonLat(lon, 'lon');
        return ns + ', ' + ew + ' (' + (lat.toFixed(5)) + ', ' + (lon.toFixed(5)) + ')';
    }

    map.addControl(new OpenLayers.Control.MousePosition({
        formatOutput: formatLonlats
    }));
    
    // map.addControl(new OpenLayers.Control.Navigation({documentDrag: true}));
    // map.addControl(new OpenLayers.Control.ArgParser());
    
    // Add attribution
    // map.addControl(new OpenLayers.Control.Attribution());
    
    // Add loading panel    
    loadingPanel = new OpenLayers.Control.LoadingPanel();
    map.addControl(loadingPanel);    
    
    // Create arrays
    reachableUrls = new Array();
    unreachableUrls = new Array();
    children = new Array();
    urls = new Array();
    // Build array of URLs
    for (i = 0; i < paramParser.getUrls().length; i++) {
        urls[i] = paramParser.getUrls()[i];
    }
    
    // ### Bounding box
    boxes = new OpenLayers.Layer.Boxes("Boxes");
    borderColor = "red";
    // Extract bounding box and bounds before AJAX call
    paramsParsed = paramParser;
    bBox = new Array(paramParser.getBBox().westBndLon, paramParser.getBBox().eastBndLon, paramParser.getBBox().northBndLat, paramParser.getBBox().southBndLat)
    
    // Add the default layers and make sure they're not included in getFeatureInfo requests
    tiled.queryable = false;
    boxes.queryable = false;   
    map.addLayer(tiled);
    map.addLayer(boxes);
    
    // Bounding box logic        
    if (isNaN(paramParser.getBBox().westBndLon) || isNaN(paramParser.getBBox().eastBndLon) || isNaN(paramParser.getBBox().southBndLat) || isNaN(paramParser.getBBox().northBndLat)) {
        // failed parsed box paramters - need to generate a default mapBounds & mapExtent
        //Ext.MessageBox.alert('Error', 'The values providing for the bounding box are not numerical.', '');
        bBoxErr = 1;
        // mapBounds = new OpenLayers.Bounds(-30.0, 48.0, 3.5, 64.0);
        // mapExtent = mapBounds.clone();
        // redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
        // boxes.addMarker(redBox);
    } else {
        if (paramParser.getBBox().westBndLon < -30.00 || paramParser.getBBox().eastBndLon > 3.50 || paramParser.getBBox().southBndLat < 48.00 || paramParser.getBBox().northBndLat > 64.00) {
            // failed parsed box paramters - need to generate a default mapBounds & mapExtent
            Ext.MessageBox.alert('Error', 'The coordinates of the bounding box are outside of the searchable map bounds.', '');
            bBoxErr = 1;
            // mapBounds = new OpenLayers.Bounds(-30.0, 48.0, 3.5, 64.0);
            // mapExtent = mapBounds.clone();
            // redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
            // boxes.addMarker(redBox);            
        } else {
            if (paramParser.getBBox().westBndLon > paramParser.getBBox().eastBndLon) {
                // failed parsed box paramters - need to generate a default mapBounds & mapExtent
                Ext.MessageBox.alert('Error', 'The west bounding longitude cannot be greater than the east bounding longitude.', '');
                bBoxErr = 1;
                // mapBounds = new OpenLayers.Bounds(-30.0, 48.0, 3.5, 64.0);
                // mapExtent = mapBounds.clone();
                // redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                // boxes.addMarker(redBox);
            } else {
                if (paramParser.getBBox().southBndLat > paramParser.getBBox().northBndLat) {
                    // failed parsed box paramters - need to generate a default mapBounds & mapExtent
                    Ext.MessageBox.alert('Error', 'The south bounding latitude cannot be greater than the north bounding latitude.', '');
                    bBoxErr = 1;
                    // mapBounds = new OpenLayers.Bounds(-30.0, 48.0, 3.5, 64.0);
                    // mapExtent = mapBounds.clone();
                    // redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                    // boxes.addMarker(redBox);
                } else {
                    // acceptable parsed box parameters - need to construct bounding box
                    mapBounds = new OpenLayers.Bounds(bBox[0], bBox[3], bBox[1], bBox[2]);
                    mapExtent = mapBounds.clone();
                    redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                    boxes.addMarker(redBox);
                    bBoxErr = 0;
                }
            }
        }
    }
    
    if (!(bBoxErr == 0))
    {
        map.layers[1].visibility = false;
    }
    
    buildUI(urls);
});

function updateInfoArray(){
    myLayerURLs = [];     // string array
    myLayers = [];        // OpenLayers.Layer.WMS array
    var len = map.layers.length;
    if (len > 2)
    {
        // at least one layer of interest has been added to the map
        // this first layer goes into the clickControl url parameter
        clickControl.url = map.layers[1].url;
        myLayers.push(map.layers[1]);
        myLayerURLs.push(map.layers[1].url);
        // // all other layers of interest go into the clickControl layerUrls parameter
        if (len > 3)
        {
            for (var i = 2; i < (len - 1); i++) {
                myLayerURLs.push(map.layers[i].url);
                myLayers.push(map.layers[i]); //.params.LAYERS);
            }        
        }
        // update the control with the new parameters
        clickControl.layerUrls = myLayerURLs;
        clickControl.layers = myLayers;
    } else {
        // update clickControl
        clickControl.url = null;
        clickControl.layerUrls = [];
        clickControl.layers = [];
    }
}

// Place bounding box layer on top
function moveLayerToTop(layer){
    var topPosition = mapPanel.map.getNumLayers() - 1;
    mapPanel.map.setLayerIndex(layer, topPosition);
}

function switchOnAllLayers(){
    for (var i = 1, len = map.layers.length; i < (len - 1); i++) {
        map.layers[i].setVisibility(true);
    }
}

// Get XML object 
function getXMLObject(){

    var xmlHttp = false;
    
    try {
    
        // Old Microsoft Browsers
        xmlHttp = new ActiveXObject("Msxml2.XMLHTTP")
        
    } 
    catch (e) {
    
        try {
        
            // Microsoft IE 6.0+
            xmlHttp = new ActiveXObject("Microsoft.XMLHTTP")
            
        } 
        catch (e2) {
        
            // Return false if no browser acceps the XMLHTTP object
            xmlHttp = false
            
        }
    }
    if (!xmlHttp && typeof XMLHttpRequest != 'undefined') {
    
        //For Mozilla, Opera Browsers
        xmlHttp = new XMLHttpRequest();
        
    }
    
    return xmlHttp;
}

// Build the UI
function buildUI(urls){

    // Test URLs
    //urls = new Array('http://domain:8080/path?query_string#fragment_id','http://12.12.23.34:8080/foo', 'http://foobar:8080/foo', 'http:/foobar', 'http//foobar.com', 'http://ogc.bgs.ac.uk/cgi-bin/BGS_1GE_Geology/wms?', 'http://ogc.bgs.ac.uk/cgi-bin/BGS_1GE_Geology/wms', 'http://ogc.bgs.ac.uk/cgi-bin/BGS_1GE_Geology/wms?request=getCapabilities&service=wms', 'http://ogc.bgs.ac.uk/cgi-bin/BGS_1GE_Geology/wms?service=wms&request=getCapabilities&');
    
    // Check the syntax of the WMS URL.  If it's invalid, remove it from the layer tree.
    // Note:  Valid URLs have the syntax:  scheme://domain:port/path?query_string#fragment_id
    
    var validUrls = new Array();
    var validUrlsEncoded = new Array();
    var invalidUrls = new Array();
    var validCounter = 0;
    var invalidCounter = 0;
    
    for (var i = 0; i < urls.length; i++) {
        if (isUrl(urls[i])) {
            // Add URL to validUrls array
            validUrls[validCounter] = urls[i];
            validCounter++;
        } else {
            // Add URL to invalidUrls array
            if (urls[i].length > 0) {
                invalidUrls[invalidCounter] = urls[i];
                invalidCounter++;
            }
        }
    }
    
    if (invalidUrls.length > 0) {    
        var errorStr = "The following WMS URLs have incorrect syntax and will not be displayed in the layer tree: <br><br>";        
        for (var i = 0; i < invalidUrls.length; i++) {
            errorStr = errorStr + invalidUrls[i] + "<br>";
        }
        Ext.MessageBox.alert('WMS Error', errorStr, '');
    }
    
    // Build layer tree from valid WMS URLs 
    for (var i = 0; i < validUrls.length; i++) {
    
        // Replace ? and & characters with their HTML encoded counterparts
        var urlWmsSuffix = validUrls[i]; // + wmsSuffix;
        urlWmsSuffix = urlWmsSuffix.replace(/\?/gi, "%3F");
        urlWmsSuffix = urlWmsSuffix.replace(/\&/gi, "%26");
        // Child definition
        child = {
            text: validUrls[i],
            qtip: validUrls[i],
            alive: true,
            loader: new os.WMSCapabilitiesLoader({
                
                // COI
                url: 'preview_proxy?url=' + urlWmsSuffix, 
                
                // Ordnance Survey
                //url: 'preview_proxy?url=' + urlWmsSuffix, 
                layerOptions: {
                    buffer: 0
                    ,singleTile: true
                    ,ratio: 1
                    ,opacity: 0.75
                    //,gutter: 50
                },
                layerParams: {
                    transparent: 'true'
                },
                createNode: function(attr){
                    attr.qtip = attr.text;
                    attr.checked = attr.leaf ? false : undefined;
                    attr.expanded = attr.leaf ? undefined : true;
                    return os.WMSCapabilitiesLoader.prototype.createNode.apply(this, [attr]);                    
                },
                listeners: {                    
                    'load': function(loader, node, response){
                        //console.log("loader has loaded: hasLayers = " + loader.hasLayers);
                        if (!(loader.hasLayers)) {
                            node.attributes.iconCls = 'failedwms-icon';
                            node.getUI().iconNode.className = node.attributes.iconCls;
                        }
                    },
                    'loadexception': function(loader, node, response){
                        //console.log("loader has loaded: hasLayers = " + loader.hasLayers);
                        node.attributes.iconCls = 'failedwms-icon';
                        node.getUI().iconNode.className = node.attributes.iconCls;
                    }
                }
            }),
            expanded: true
        };        
        children[i] = child;
        
    }
        
    var browser = navigator.userAgent;
    if ((browser.toLowerCase().indexOf('safari') > 0) || (/MSIE (\d+\.\d+);/.test(navigator.userAgent))) {
        // set max. length of qtip on child nodes
        for(var i=0; i<children.length; i++) {
            var qtipString = children[i].qtip;
            if (qtipString.length > 50)
            {
                children[i].qtip = qtipString.substring(0,49) + "<br>" + qtipString.substring(50,(qtipString.length));
            }
        }
    }
    
    // Define the root for the layer tree
    root = new Ext.tree.AsyncTreeNode({
        id: 'root',
        children: children
    });
        
    // Create checkbox for toggling backdrop map on/off
    var checkboxes = new Ext.form.CheckboxGroup({    
        items: [{        
            boxLabel: 'Backdrop Map',            
            checked: true,            
            handler: function checkvalue(){
                var obj = Ext.select('input[type=checkbox]').elements;
                var i = 0;                
                // Toggle backdrop map on/off
                if (obj[i].checked) {
                    tiled.setVisibility(true);
                    tiled.redraw();                    
                }
                else {
                    tiled.setVisibility(false);
                }
            }
        }]
    });    
    
    // Define the layer tree
    layerTree = new Ext.tree.TreePanel({        
        id: 'tree',
        border: false,
        width: 650,
        root: root,        
        rootVisible: false,
        animate: true,
        lines: true, 
        //autoScroll: true,        
        listeners: {        
            // Add layers to the map when checked and remove when unchecked
            'checkchange': function(node, checked){
                if (checked === true) {
                    // set layer projection to match map projection
                    switch (mapPanel.map.options.projection)
                    {
                        case "EPSG:4258":
                            //console.log("adjusting layer to suit 4258");
                            node.attributes.layer.get('layer').addOptions(options4258); 
                            //console.log("layer is using " + node.attributes.layer.get('layer').projection.projCode);
                            break;
                        case "EPSG:4326":
                            //console.log("adjusting layer to suit 4326");
                            node.attributes.layer.get('layer').addOptions(options4326); 
                            //console.log("layer is using " + node.attributes.layer.get('layer').projection.projCode);
                            break;
                        case "EPSG:27700":
                            //console.log("adjusting layer to suit 27700");
                            node.attributes.layer.get('layer').addOptions(options27700); 
                            //console.log("layer is using " + node.attributes.layer.get('layer').projection.projCode);
                            break;
                        case "EPSG:29903":
                            //console.log("adjusting layer to suit 29903");
                            node.attributes.layer.get('layer').addOptions(options29903); 
                            //console.log("layer is using " + node.attributes.layer.get('layer').projection.projCode);
                            break;
                        case "EPSG:2157":
                            //console.log("adjusting layer to suit 2157");
                            node.attributes.layer.get('layer').addOptions(options2157); 
                            //console.log("layer is using " + node.attributes.layer.get('layer').projection.projCode);
                            break;
                        default:
                            node.attributes.layer.get('layer').addOptions(options4258); 
                    }                    
                    //node.attributes.layer.attribution = "";
                    mapPanel.layers.add(node.attributes.layer);
                    // for testing purposes paramsParsed carries Info/Exception formats defined by testing
                    if (paramsParsed.getInfoFormat() == null) {
                        mapPanel.map.layers[mapPanel.map.getNumLayers() -1].params.INFO_FORMAT = node.attributes.layer.data.INFO_FORMAT;
                    } else {
                        mapPanel.map.layers[mapPanel.map.getNumLayers() -1].params.INFO_FORMAT = paramsParsed.getInfoFormat();
                    }
                    if (paramsParsed.getExceptions() == null) {
                        mapPanel.map.layers[mapPanel.map.getNumLayers() -1].params.EXCEPTIONS = node.attributes.layer.data.EXCEPTIONS;                    
                    } else {
                        mapPanel.map.layers[mapPanel.map.getNumLayers() -1].params.EXCEPTIONS = paramsParsed.getExceptions();                    
                    }
                    mapPanel.map.layers[mapPanel.map.getNumLayers() -1].attribution = "";
                    // force redraw (in case projection is not supported and we'd like to see the warning message)
                    mapPanel.map.layers[mapPanel.map.getNumLayers() -1].clearGrid();
                    mapPanel.map.layers[mapPanel.map.getNumLayers() -1].redraw(true);
                    // add listener for tileerror event
                    mapPanel.map.layers[mapPanel.map.getNumLayers() -1].events.register("tileerror", this, function(e) {
                        if (e.tile)
                        {
                            if (e.tile.layer.url)
                            {
                                Ext.MessageBox.alert('Error', ("The WMS source: " + e.tile.layer.url + " has failed to load - please switch it off or try a different projection."));
                            }
                        }                            
                        // this.root.node.childNodes loop for wms url match and turn off
                    }); 
                    // debug code for loadingPanel counter
                    var layerName = node.attributes.layer.name;
                    mapPanel.map.layers[mapPanel.map.getNumLayers() -1].events.register("added", this, function(e) {
                        //console.log("adding layer");
                    });
                    mapPanel.map.layers[mapPanel.map.getNumLayers() -1].events.register("removed", this, function(e) {
                        //console.log("removing layer");
                    });                    
                } else {
                    mapPanel.layers.remove(node.attributes.layer);        
                }
                moveLayerToTop(boxes);
                updateInfoArray();                    
            },
            'load': function(node){
                // if a node receives a response and no layer child nodes are created we want to change the icon
                // also fires if request is aborted (should this be the case though?)
                if (!(node.isRoot)) {
                    if (node.childNodes) {                
                        if (node.childNodes)
                        {
                            if (node.childNodes.length == 0)
                            {
                                node.attributes.iconCls = 'failedwms-icon';
                                node.getUI().iconNode.className = node.attributes.iconCls;
                            }
                        }
                    }
                }
            },
            // loadexception - is this a valid event?
            'loadexception': function(node){
                node.attributes.iconCls = 'failedwms-icon';
                node.getUI().iconNode.className = node.attributes.iconCls;
            }
        }
    });
    
    // remove key press events for zoomslider - otherwise cursor up/down fire zoom in/out
    GeoExt.ZoomSlider.prototype.onKeyDown = function(e) {};
    
    // Define the Map panel
    mapPanel = new GeoExt.MapPanel({
        map: map,
        region: 'center',
        //renderTo: "div-map",
        // items: []
        items: [{
            xtype: "gx_zoomslider",
            vertical: true,
            // Length of slider
            height: 150,
            // x,y position of slider
            x: 10,
            y: 20,
            // Tooltips
            plugins: new GeoExt.ZoomSliderTip({
                template: "Zoom level: {zoom}<br>Scale: 1 : {scale}"
            })
        }]
    });
    
    // Define the projection data for the projection combobox
    var projectionData = new Ext.data.SimpleStore({
        id: 0,
        fields: [{
            name: 'projectionName'
        }, {
            name: 'epsg'
        }],
        data: [['ETRS89', '4258'], ['WGS84', '4326'], ['British National Grid', '27700'], ['Irish Grid', '29903'], ['Irish Transverse Mercator', '2157']]
    });
    
    // define projections
    var proj4258 = new OpenLayers.Projection("EPSG:4258");
    var proj4326 = new OpenLayers.Projection("EPSG:4326");
    var proj27700 = new OpenLayers.Projection("EPSG:27700");
    var proj2157 = new OpenLayers.Projection("EPSG:2157");
    var proj29903 = new OpenLayers.Projection("EPSG:29903");
    
    // build options for map
    var options4258 = {
        // proper bounds for ETRS89
        maxExtent: new OpenLayers.Bounds(-30, 48.00, 3.50, 64.00),
        restrictedExtent: new OpenLayers.Bounds(-30, 48.00, 3.50, 64.00),
        projection: "EPSG:4258",
        units: "degrees"
    };
    var options4326 = {
        // bounds for WGS84
        maxExtent: new OpenLayers.Bounds(-30, 48.00, 3.50, 64.00),
        restrictedExtent: new OpenLayers.Bounds(-30, 48.00, 3.50, 64.00),
        projection: "EPSG:4326",
        units: "degrees"
    };
    var options27700 = {
        // proper bounds for BNG
        maxExtent: new OpenLayers.Bounds(-1676863.69127, -211235.79185, 810311.58692, 1870908.806),
        restrictedExtent: new OpenLayers.Bounds(-1676863.69127, -211235.79185, 810311.58692, 1870908.806),
        projection: "EPSG:27700",
        units: "m"
    };
    var options2157 = {
        // proper bounds for ITM        
        maxExtent: new OpenLayers.Bounds(-1036355.59295, 138271.94508, 1457405.79374, 2105385.88137),
        restrictedExtent: new OpenLayers.Bounds(-1036355.59295, 138271.94508, 1457405.79374, 2105385.88137),
        projection: "EPSG:2157",
        units: "m"
    };
    var options29903 = {
        // proper bounds for IG
        maxExtent: new OpenLayers.Bounds(-1436672.42532, -361887.06768, 1057647.39762, 1605667.48446),
        restrictedExtent: new OpenLayers.Bounds(-1436672.42532, -361887.06768, 1057647.39762, 1605667.48446),
        projection: "EPSG:29903",
        units: "m"
    };
    
    // Define the form panel for the projection logic
    var formPanel = new Ext.form.FormPanel({    
        labelWidth: 140,
        border: false,        
        items: [{
            xtype: "combo",
            id: 'projectionCombo',
            fieldLabel: "Backdrop Map Projection",
            emptyText: 'Projection',
            store: projectionData,
            displayField: 'projectionName',
            valueField: 'epsg',
            hiddenName: 'theEPSG',
            selectOnFocus: true,
            mode: 'local',
            typeAhead: true,
            editable: false,
            triggerAction: "all",
            value: '4258',
            listeners: {                
                select: function(combo, record, index){                                
                    var epsg = "EPSG:" + combo.getValue();                    
                    switch (epsg) {
                        case "EPSG:4258":                            
                            // ETRS89
                            var centre = mapPanel.map.getCenter();
                            //console.log("centre: " + centre.toShortString());                            
                            var zoom = mapPanel.map.getZoom();
                            var srcProj = mapPanel.map.getProjectionObject();
                            // transform centre
                            centre.transform(srcProj, proj4258);
                            //console.log("centre: " + centre.toShortString() + " 4258");
                            // set sea raster
                            mapPanel.map.baseLayer.mergeNewParams({
                                //LAYERS: 'sea_dtm,InspireVectorStack'
                                LAYERS: 'InspireETRS89'
                            });
                            //mapPanel.map.baseLayer.redraw();                            
                            // reset map
                            mapPanel.map.setOptions(options4258);
                            mapPanel.map.options.projection = "EPSG:4258";                            
                            // reset layers
                            for (var i = 0, len = mapPanel.map.layers.length; i < len; i++) {
                                mapPanel.map.layers[i].addOptions(options4258);
                                if (mapPanel.map.layers[i].name == "Boxes") {
                                    if (bBoxErr == 0) {
                                        if (redBox != null) {
                                            mapExtent = mapBounds.clone();
                                            mapExtent.transform(proj4326, proj4258);
                                            mapPanel.map.layers[i].removeMarker(redBox);
                                            redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                                            mapPanel.map.layers[i].addMarker(redBox);
                                            mapPanel.map.layers[i].redraw();
                                        }
                                    }
                                }
                            }
                            //switchOnAllLayers();
                            // centre map
                            mapPanel.map.setCenter(centre, zoom, true, true);
                            //console.log("map centre: " + mapPanel.map.getCenter().toShortString() + " 4258");
                            // for(var i=0,len=mapPanel.map.layers.length; i<len; i++) {
                                // mapPanel.map.layers[i].redraw();
                                // mapPanel.map.layers[i].clearGrid();
                            // }
                            break;
                            
                        case "EPSG:4326":
                            
                            // WGS84
                            var centre = mapPanel.map.getCenter();
                            //console.log("centre: " + centre.toShortString());                            
                            var zoom = mapPanel.map.getZoom();
                            var srcProj = mapPanel.map.getProjectionObject();
                            // transform centre
                            centre.transform(srcProj, proj4326);
                            //console.log("centre: " + centre.toShortString() + " 4326");
                            // set sea rasters
                            mapPanel.map.baseLayer.mergeNewParams({
                                //LAYERS: 'sea_dtm_4326,InspireVectorStack'
                                LAYERS: 'InspireWGS84'
                            });
                            //mapPanel.map.baseLayer.redraw();                                                        
                            // reset map
                            mapPanel.map.setOptions(options4326);
                            mapPanel.map.options.projection = "EPSG:4326";
                            // reset layers
                            for (var i = 0, len = mapPanel.map.layers.length; i < len; i++) {
                                mapPanel.map.layers[i].addOptions(options4326);
                                if (mapPanel.map.layers[i].name == "Boxes") {
                                    if (bBoxErr == 0) {
                                        if (redBox != null) {
                                            mapExtent = mapBounds.clone();
                                            mapPanel.map.layers[i].removeMarker(redBox);
                                            redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                                            mapPanel.map.layers[i].addMarker(redBox);
                                            mapPanel.map.layers[i].redraw();
                                        }
                                    }
                                }
                            }
                            //switchOnAllLayers();
                            // centre map
                            mapPanel.map.setCenter(centre, zoom, true, true);
                            //console.log("map centre: " + mapPanel.map.getCenter().toShortString() + " 4326");
                            // for(var i=0,len=mapPanel.map.layers.length; i<len; i++) {
                                // mapPanel.map.layers[i].redraw();
                                // mapPanel.map.layers[i].clearGrid();
                            // }
                            break;
                            
                        case "EPSG:27700":
                            
                            // British National Grid
                            var centre = mapPanel.map.getCenter();
                            //console.log("centre: " + centre.toShortString());
                            var zoom = mapPanel.map.getZoom();
                            var srcProj = mapPanel.map.getProjectionObject();
                            // transform centre
                            centre.transform(srcProj, proj27700);
                            //console.log("centre: " + centre.toShortString() + " 27700");
                            // set sea rasters
                            mapPanel.map.baseLayer.mergeNewParams({
                                //LAYERS: 'sea_dtm,InspireVectorStack'
                                LAYERS: 'InspireBNG'
                            });
                            //mapPanel.map.baseLayer.redraw();                                                        
                            // reset map                            
                            mapPanel.map.setOptions(options27700);
                            mapPanel.map.options.projection = "EPSG:27700";
                            // reset layers
                            for (var i = 0, len = mapPanel.map.layers.length; i < len; i++) {
                                mapPanel.map.layers[i].addOptions(options27700);
                                if (mapPanel.map.layers[i].name == "Boxes") {
                                    if (bBoxErr == 0) {
                                        if (redBox != null) {
                                            mapExtent = mapBounds.clone();
                                            mapExtent.transform(proj4326, proj27700);
                                            mapPanel.map.layers[i].removeMarker(redBox);
                                            redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                                            mapPanel.map.layers[i].addMarker(redBox);
                                            mapPanel.map.layers[i].redraw();
                                        }
                                    }
                                }
                            }
                            // centre map
                            mapPanel.map.setCenter(centre, zoom, true, true);
                            //console.log("map centre: " + mapPanel.map.getCenter().toShortString() + " 27700");
                            // for(var i=0,len=mapPanel.map.layers.length; i<len; i++) {
                                // mapPanel.map.layers[i].redraw();
                                // mapPanel.map.layers[i].clearGrid();
                            // }
                            break;
                            
                        case "EPSG:2157":
                            
                            // Irish Transverse Mercator
                            var centre = mapPanel.map.getCenter();
                            //console.log("centre: " + centre.toShortString());                            
                            var zoom = mapPanel.map.getZoom();
                            var srcProj = mapPanel.map.getProjectionObject();
                            // transform centre
                            centre.transform(srcProj, proj2157);
                            //console.log("centre: " + centre.toShortString() + " 2157");
                            // set sea rasters
                            mapPanel.map.baseLayer.mergeNewParams({
                                //LAYERS: 'sea_dtm,InspireVectorStack'
                                LAYERS: 'InspireITM'
                            });
                            // mapPanel.map.baseLayer.redraw();                            
                            // reset map
                            mapPanel.map.setOptions(options2157);
                            mapPanel.map.options.projection = "EPSG:2157";
                            // reset layers
                            for (var i = 0, len = mapPanel.map.layers.length; i < len; i++) {
                                mapPanel.map.layers[i].addOptions(options2157);
                                if (mapPanel.map.layers[i].name == "Boxes") {
                                    if (bBoxErr == 0) {
                                        if (redBox != null) {
                                            mapExtent = mapBounds.clone();
                                            mapExtent.transform(proj4326, proj2157);
                                            mapPanel.map.layers[i].removeMarker(redBox);
                                            redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                                            mapPanel.map.layers[i].addMarker(redBox);
                                            mapPanel.map.layers[i].redraw();
                                        }
                                    }
                                }
                            }
                            //switchOnAllLayers();
                            // centre map
                            mapPanel.map.setCenter(centre, zoom, true, true);
                            //console.log("map centre: " + mapPanel.map.getCenter().toShortString() + " 2157");
                            //for(var i=0,len=mapPanel.map.layers.length; i<len; i++) {
                                //mapPanel.map.layers[i].redraw();
                                //mapPanel.map.layers[i].clearGrid();
                            //}                            
                            break;
                            
                        case "EPSG:29903":
                            
                            // Irish Grid
                            var centre = mapPanel.map.getCenter();
                            //console.log("centre: " + centre.toShortString());                            
                            var zoom = mapPanel.map.getZoom();
                            var srcProj = mapPanel.map.getProjectionObject();
                            // transform centre
                            centre.transform(srcProj, proj29903);
                            //console.log("centre: " + centre.toShortString() + " 29903");
                            // set sea rasters
                            mapPanel.map.baseLayer.mergeNewParams({
                                //LAYERS: 'sea_dtm,InspireVectorStack'
                                LAYERS: 'InspireIG'
                            });
                            //mapPanel.map.baseLayer.redraw();                            
                            // reset map
                            mapPanel.map.setOptions(options29903);
                            mapPanel.map.options.projection = "EPSG:29903";                            
                            // reset layers
                            for (var i = 0, len = mapPanel.map.layers.length; i < len; i++) {
                                mapPanel.map.layers[i].addOptions(options29903);
                                if (mapPanel.map.layers[i].name == "Boxes") {
                                    if (bBoxErr == 0) {
                                        if (redBox != null) {
                                            mapExtent = mapBounds.clone();
                                            mapExtent.transform(proj4326, proj29903);
                                            mapPanel.map.layers[i].removeMarker(redBox);
                                            redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                                            mapPanel.map.layers[i].addMarker(redBox);
                                            mapPanel.map.layers[i].redraw();
                                        }
                                    }
                                }
                            }
                            //switchOnAllLayers();
                            // centre map
                            mapPanel.map.setCenter(centre, zoom, true, true);
                            //console.log("map centre: " + mapPanel.map.getCenter().toShortString() + " 29903");
                            //for(var i=0,len=mapPanel.map.layers.length; i<len; i++) {
                                //mapPanel.map.layers[i].redraw();
                                //mapPanel.map.layers[i].clearGrid();
                            //}                            
                            break;
                            
                        default:
                            
                            // ETRS89
                            var centre = mapPanel.map.getCenter();
                            var zoom = mapPanel.map.getZoom();
                            var srcProj = mapPanel.map.getProjectionObject();
                            // transform centre
                            centre.transform(srcProj, proj4258);
                            // set sea rasters
                            mapPanel.map.baseLayer.mergeNewParams({
                                //LAYERS: 'sea_dtm,InspireVectorStack'
                                LAYERS: 'InspireETRS89'
                            });
                            //mapPanel.map.baseLayer.redraw();                            
                            // reset map
                            mapPanel.map.setOptions(options4258);
                            mapPanel.map.options.projection = "EPSG:4258";                            
                            // reset layers
                            for (var i = 0, len = mapPanel.map.layers.length; i < len; i++) {
                                mapPanel.map.layers[i].addOptions(options4258);
                                if (mapPanel.map.layers[i].name == "Boxes") {
                                    if (bBoxErr == 0) {
                                        if (redBox != null) {
                                            mapExtent = mapBounds.clone();
                                            mapExtent.transform(proj4326, proj4258);
                                            mapPanel.map.layers[i].removeMarker(redBox);
                                            redBox = new OpenLayers.Marker.Box(mapExtent, borderColor);
                                            mapPanel.map.layers[i].addMarker(redBox);
                                            mapPanel.map.layers[i].redraw();
                                        }
                                    }
                                }
                            }
                            //switchOnAllLayers();
                            // centre map
                            mapPanel.map.setCenter(centre, zoom, true, true);
                            //for(var i=0,len=mapPanel.map.layers.length; i<len; i++) {
                                //mapPanel.map.layers[i].redraw();
                                //mapPanel.map.layers[i].clearGrid();
                            //}                            
                    }
                } // end of function for selecting combo
            } // end of combo listeners
        }] // end of items
    }); // end of formpanel def
    
    // Define the Legend panel
    var legendPanel = new GeoExt.LegendPanel({
    
        // Remove OS base layer from the legend
        filter: function(record){
            return !record.get("layer").isBaseLayer;
        },
        
        autoScroll: true,
        width: 348,
        
        bodyStyle: 'padding:5px',
        border: false,
        
        map: this.map,
        
        defaults: {
            style: 'padding:5px',
            baseParams: {
                FORMAT: 'image/png',
                width: 600   
            }        
        },
        title: '<b>Legend</b>',
        collapsible: true
                    
    });
    
    // Define the Layers panel, which will contain projection dropdown, backdrop map toggle and the layer tree
    var layersPanel = new Ext.Panel({
    
        title: '<b>Layers</b>',
        collapsible: true,
        bodyStyle: 'padding:5px', // font-family: Arial; font-weight: bold; font-size: 23px',
        //width: 348,
        autoScroll: true,
                        
        
        items: [formPanel, checkboxes, layerTree]
    
    });
    
    // Define the Information panel
    var infoPanel = new Ext.Panel({
        title: '<b>Information</b>'
        ,collapsible: true
        ,width: 358
        ,border: false
        ,bodyStyle: "padding:10px"
        ,autoScroll: true                        
        // renderTo: 'info',        
        ,style: 'font-family: Arial; font-size: 13px'        
        ,html: "<a href=\"/doc/map-preview\" target=\"_blank\" title=\"Open Help Window\">Need help getting started?</a><br><br>"
        +"Please note:<br><br>"
        +"<b>&#149;</b> Where a rotating circle remains in the WMS Layers window, this indicates that the service is still waiting for a response from that publisher's WMS. This is due to their server not being available or to network problems.<br>"
        +"<b>&#149;</b> Backdrop mapping is available at zoom levels up to the scale of 1:10 000. Additional zoom levels without backdrop mapping are provided to enable viewing of large scale data.<br>"
        +"<b>&#149;</b> On selecting a layer, you may need to zoom in or out to see the data as the Publisher's WMS may restrict the scales at which it can be viewed. <br>"
        +"<b>&#149;</b> You may need to pan to view the data if it is outside current window view. <br>"
        +"<b>&#149;</b> Not all map layers support all projections. If a layer does not display then it may be possible for it to display by choosing a different projection.  <br>"
        +"<b>&#149;</b> To view feature information about the data layers being displayed, position the mouse cursor over the point of interest and click the left button once. A pop-up window will be displayed containing information about features within each layer at that point. If no information is returned, this could be due to there being no features at the point of interest, no support for feature information by the publisher's WMS or a format returned by the WMS which is not supported by the Preview on Map tool. <br>"
        +"<b>&#149;</b> All the backdrop mapping displayed in this window is derived from small scale data and is intended to aid evaluation of selected data sets only. It should not be used to assess their positional accuracy. <br>"
        +"<b>&#149;</b> Users of Internet Explorer  and Opera will find the map pan tool doesn't work in the copyright section. This is a known issue with the mapping framework. A fix will be provided in a future release. <br>" 
        +'<b>&#149;</b> Further advice and guidance on all of these notes is provided in the <a href="UKLP_HELP_DOCUMENTATION">Preview on Map User Guide</a>.<br>'    
    });
        
    // Create a panel for Layers, Legend and Information
    leftPanel = new Ext.Panel({    
        border: false,
        region: 'west',
        width: 348,
        minWidth: 348,
        collapsible: true,
        collapseMode: "mini",
        layout: 'accordion', // Only one panel can be open at a time        
        align: 'stretch',
        split:true,
        minWidth: 200,
        maxWidth: 348,                
        items: [layersPanel, legendPanel, infoPanel]
    });
    
    // Define a viewport.  Left panel (Layers, Legend and Information) will be on the left, and the map will be on the right
    new Ext.Viewport({
        layout: "fit",        
        hideBorders: false,
        border: true,
        items: {
            layout: "border",
            deferredRender: false,
            items: [leftPanel, mapPanel]
        }
        ,listeners: {
            afterrender: function(c) {
                // update keyboard control div with map.div
                //var keyboardControl = map.getControlsByClass("OpenLayers.Control.KeyboardDefaults");
                // at this point the div of map is div.olMap
                // but this is changed at some point after...
                
                // keyboardControl.observerElement = "olMap";
                //console.log("map div:" + mapPanel.map.div.id);
                //keyboardControl.div = "cheerypie"; //mapPanel.map.div;
                // var mapDiv = "" + mapPanel.map.div.id
                // console.log(mapDiv);
                // map.addControl(new OpenLayers.Control.KeyboardDefaults({
                    // autoActivate: true,
                    // observeElement: mapPanel.map.div //mapDiv
                // }));
                // var keyControl = map.getControlsByClass("OpenLayers.Control.PanZoom");
                // keyControl.div = mapDiv;
            }
        }
    });
    
    // If no bounding box issues, zoom to the mapBounds
    if (bBoxErr == 0) {
        map.zoomToExtent(mapBounds);
    } else {
        mapBounds = new OpenLayers.Bounds(-30, 48.00, 3.50, 64.00);
        //mapBounds = new OpenLayers.Bounds(-13.02, 49.79, 3.26, 60.95); // Centred upon British Isles
        mapExtent = mapBounds.clone();
        map.zoomToExtent(mapBounds);
    }
    
}

// Display error message if there is one or more unreachable WMS URLs
function displayUnreachableMsg(unreachableUrls){

    var errorStr;
    
    if (unreachableUrls.length > 0) {
    
        if (unreachableUrls.length == 1) {
            errorStr = "The following Web Map Service URL could not be reached:<br><br>";
        }
        else {
            errorStr = "The following " + unreachableUrls.length + " Web Map Services could not be reached:<br><br>";
        }
        
        for (var i = 0; i < unreachableUrls.length; i++) {
            errorStr = errorStr + unreachableUrls[i] + "<br>";
        }
        
        if (reachableUrls.length == 0) {
            errorStr = errorStr + "<br>There are no Web Map Services to overlay.  Please try again."
        }
        
        Ext.MessageBox.alert('WMS Error', errorStr, '');
    }
    
}

//function to check/uncheck all the child node.
function toggleCheck(node, isCheck){
    if (node) {
        var args = [isCheck];
        node.cascade(function(){
            c = args[0];
            this.ui.toggleCheck(c);
            this.attributes.checked = c;
        }, null, args);
    }
}

// Check if a URL has correct syntax
function isUrl(s){
    var regexp = /(http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/
    return regexp.test(s);
}

function getHostname(str){
    var re = new RegExp('^(?:f|ht)tp(?:s)?\://([^/]+)', 'im');
    return str.match(re)[1].toString();
}

//function to inspect WMS tree - looking for visible single layers
//was used by the info tool to improve layer naming where layer names
//are not returned by getFeatureInfo requests
//now redundant - could be brought back to improve info results
function checkForSingleLayerInWMS(wmsURL){
    var strWMSURL = wmsURL.replace("?","");
    var root = tree.getRootNode();
    var children = root.childNodes;
    var visibleLayers = 0;
    var layerName;
    for (var i = 0; i < children.length; i++) {
        //alert("checking " + children[i].text.replace("?","") + " for " + strWMSURL);
        if (children[i].text.replace("?","") == strWMSURL ) {
            children[i].cascade(function(n){
                var ui = n.getUI();
                if (ui.isChecked())
                {
                    visibleLayers++;
                    layerName = n.text;
                }
            });
        }
    }
    if (visibleLayers == 1)
    {
        // we can be sure this is the layer in question
        return layerName;
    } else {
        return "";
    }
}

function StringtoXML(text){
    if (window.ActiveXObject){
        var doc=new ActiveXObject('Microsoft.XMLDOM');
        doc.async='false';
        doc.loadXML(text);
    } else {
        var parser=new DOMParser();
        var doc=parser.parseFromString(text,'text/xml');
    }
    return doc;
}

function featuresAttributestoHTMLTable(feature){
    var returnedTable = '<table class="popup">';
    
    for(var prop in feature.attributes) {
        if(feature.attributes.hasOwnProperty(prop))
            returnedTable += "<tr><td>" + prop + "</td><td>" + feature.attributes[prop] + "</td></tr>";
    }

    // this doesn't work in IE7-9 :-/
    // Object.keys(feature.attributes).forEach(function(key) {
        // returnedTable += "<tr><td>" + key + "</td><td>" + feature.attributes[key] + "</td></tr>";
    // });
    
    returnedTable += "</table>";
    return returnedTable;
}

// Replaces all instances of the given substring.
String.prototype.replaceAll = function(strTarget, strSubString ){
    var strText = this;
    var intIndexOfMatch = strText.indexOf( strTarget );
    while (intIndexOfMatch != -1){
        strText = strText.replace( strTarget, strSubString )
        intIndexOfMatch = strText.indexOf( strTarget );
    }
    return( strText );
}
