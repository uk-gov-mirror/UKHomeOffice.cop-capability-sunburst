/*
 *  Power BI Visualizations
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */
module powerbi.extensibility.visual {
    // powerbi.extensibility
    import IVisual = powerbi.extensibility.IVisual;
    import IColorPalette = powerbi.extensibility.IColorPalette;

    // powerbi.visuals
    import ISelectionId = powerbi.visuals.ISelectionId;

    // powerbi.extensibility.utils.color
    import ColorHelper = powerbi.extensibility.utils.color.ColorHelper;

    // powerbi.extensibility.utils.type
    import PixelConverter = powerbi.extensibility.utils.type.PixelConverter;

    // powerbi.extensibility.utils.tooltip
    import TooltipEventArgs = powerbi.extensibility.utils.tooltip.TooltipEventArgs;
    import ITooltipServiceWrapper = powerbi.extensibility.utils.tooltip.ITooltipServiceWrapper;
    import TooltipEnabledDataPoint = powerbi.extensibility.utils.tooltip.TooltipEnabledDataPoint;
    import createTooltipServiceWrapper = powerbi.extensibility.utils.tooltip.createTooltipServiceWrapper;

    // powerbi.extensibility.utils.svg
    import translate = powerbi.extensibility.utils.svg.translate;
    import CssConstants = powerbi.extensibility.utils.svg.CssConstants;
    import ClassAndSelector = powerbi.extensibility.utils.svg.CssConstants.ClassAndSelector;
    import createClassAndSelector = powerbi.extensibility.utils.svg.CssConstants.createClassAndSelector;

    // powerbi.extensibility.utils.formatting
    import valueFormatter = powerbi.extensibility.utils.formatting.valueFormatter;
    import IValueFormatter = powerbi.extensibility.utils.formatting.IValueFormatter;

    // powerbi.extensibility.utils.chart.legend
    import createLegend = powerbi.extensibility.utils.chart.legend.createLegend;
    import ILegend = powerbi.extensibility.utils.chart.legend.ILegend;
    import Legend = powerbi.extensibility.utils.chart.legend;
    import LegendData = powerbi.extensibility.utils.chart.legend.LegendData;
    import LegendIcon = powerbi.extensibility.utils.chart.legend.LegendIcon;
    import LegendPosition = powerbi.extensibility.utils.chart.legend.LegendPosition;

    // powerbi.extensibility.utils.interactivity
    import IInteractiveBehavior = powerbi.extensibility.utils.interactivity.IInteractiveBehavior;
    import IInteractivityService = powerbi.extensibility.utils.interactivity.IInteractivityService;

    import Behavior = behavior.Behavior;
    import BehaviorOptions = behavior.BehaviorOptions;
    import InteractivityService = behavior.InteractivityService;

    interface IAppCssConstants {
        main: ClassAndSelector;
        mainInteractive: ClassAndSelector;
        slice: ClassAndSelector;
        sliceSelected: ClassAndSelector;
        sliceHidden: ClassAndSelector;
        label: ClassAndSelector;
        labelVisible: ClassAndSelector;
        categoryLabel: ClassAndSelector;
        percentageLabel: ClassAndSelector;
        sliceLabel: ClassAndSelector;
    }

    export class Sunburst implements IVisual {
        private static ViewBoxSize: number = 500;
        private static CentralPoint: number = Sunburst.ViewBoxSize / 2;
        private static OuterRadius: number = Sunburst.ViewBoxSize / 2;
        private static PercentageFontSizeMultiplier: number = 2;
        private static CategoryLineInterval: number = 0.6;
        private static DefaultPercentageLineInterval: number = 0.25;
        private static MultilinePercentageLineInterval: number = 0.6;

        private static DefaultDataLabelPadding: number = 15;

        private static LegendPropertyIdentifier: DataViewObjectPropertyIdentifier = {
            objectName: "group",
            propertyName: "fill"
        };

        private toggleLabels(isShown: boolean = true) {
            this.percentageLabel.classed(
                this.appCssConstants.labelVisible.className,
                isShown
            );

            this.selectedCategoryLabel.classed(
                this.appCssConstants.labelVisible.className,
                isShown && this.settings.group.showSelected
            );
        }

        private settings: SunburstSettings;

        private visualHost: IVisualHost;
        private data: SunburstData;
        private arc: d3.svg.Arc<SunburstDataPoint>;
        private chartWrapper: d3.Selection<{}>;
        private svg: d3.Selection<{}>;
        private main: d3.Selection<{}>;
        private percentageLabel: d3.Selection<string>;
        private percentageFormatter: IValueFormatter;
        private selectedCategoryLabel: d3.Selection<string>;

        private appCssConstants: IAppCssConstants = {
            main: createClassAndSelector("sunburst"),
            mainInteractive: createClassAndSelector("sunburst--interactive"),
            slice: createClassAndSelector("sunburst__slice"),
            sliceSelected: createClassAndSelector("sunburst__slice--selected"),
            sliceHidden: createClassAndSelector("sunburst__slice--hidden"),
            label: createClassAndSelector("sunburst__label"),
            labelVisible: createClassAndSelector("sunburst__label--visible"),
            categoryLabel: createClassAndSelector("sunburst__category-label"),
            percentageLabel: createClassAndSelector("sunburst__percentage-label"),
            sliceLabel: createClassAndSelector("sunburst__slice-label")
        };

        private colorPalette: IColorPalette;
        private colorHelper: ColorHelper;

        private interactivityService: IInteractivityService;
        private behavior: IInteractiveBehavior = new Behavior();

        private tooltipService: ITooltipServiceWrapper;
        private viewport: IViewport;
        private legend: ILegend;
        private legendData: LegendData;

        private smallestCapabablityFontSize: number = null;

        constructor(options: VisualConstructorOptions) {
            this.visualHost = options.host;

            this.tooltipService = createTooltipServiceWrapper(
                options.host.tooltipService,
                options.element
            );

            this.percentageFormatter = valueFormatter.create({ format: "0.00%;-0.00%;0.00%" });

            this.colorPalette = this.visualHost.colorPalette;
            this.colorHelper = new ColorHelper(this.colorPalette);

            // let arcSizeFactor: number = 10;
            // let arcSizeFactors: any = [200, 10, 10, 10];
            let radiusFactors: any = [0.2, 0.45, 0.7, 1];

            this.arc = d3.svg.arc<SunburstDataPoint>()
                .startAngle((slice: SunburstDataPoint) => slice.x)
                .endAngle((slice: SunburstDataPoint) => slice.x + slice.dx)
                .innerRadius((slice: SunburstDataPoint) => {
                    //let y: number = (slice.y) / (Sunburst.OuterRadius);
                    let y: number = (Sunburst.OuterRadius) * radiusFactors[slice.depth - 1];
                    // let dy: number = slice.dy / Sunburst.OuterRadius / arcSizeFactors[slice.depth - 1];
                    // let toAdd: number = this.maxLevels > slice.depth ? (this.maxLevels - slice.depth) * dy : 0;
                    return y;// + toAdd;
                })
                .outerRadius((slice: SunburstDataPoint) => {
                    //let y2: number = (slice.y + slice.dy) / (Sunburst.OuterRadius);
                    let y2: number = (Sunburst.OuterRadius) * radiusFactors[slice.depth];
                    // let dy: number = slice.dy / Sunburst.OuterRadius / arcSizeFactors[slice.depth];
                    // let toAdd: number = this.maxLevels > slice.depth ? (this.maxLevels - slice.depth) * dy : 0;
                    return y2;// + toAdd - dy;
                });

            this.colorPalette = options.host.colorPalette;

            this.interactivityService = new InteractivityService(
                options.host,
                this.onVisualSelection.bind(this),
            );

            this.chartWrapper = d3.select(options.element)
                .append("div")
                .classed(this.appCssConstants.main.className, true);

            this.svg = this.chartWrapper
                .append("svg")
                .attr("viewBox", `0 0 ${Sunburst.ViewBoxSize} ${Sunburst.ViewBoxSize}`)
                .attr("width", "100%")
                .attr("height", "100%")
                .attr("preserveAspectRatio", "xMidYMid meet");

            this.main = this.svg.append("g");
            this.main.attr(CssConstants.transformProperty, translate(Sunburst.CentralPoint, Sunburst.CentralPoint));

            this.selectedCategoryLabel = <d3.Selection<string>>this.svg
                .append("text")
                .classed(this.appCssConstants.label.className, true)
                .classed(this.appCssConstants.categoryLabel.className, true);

            this.selectedCategoryLabel.attr("x", Sunburst.CentralPoint);
            this.selectedCategoryLabel.attr("y", Sunburst.CentralPoint);

            this.percentageLabel = <d3.Selection<string>>this.svg
                .append("text")
                .classed(this.appCssConstants.label.className, true)
                .classed(this.appCssConstants.percentageLabel.className, true);
            this.percentageLabel.attr("x", Sunburst.CentralPoint);
            this.percentageLabel.attr("y", Sunburst.CentralPoint);

            // create legend container
            this.legend = createLegend(options.element,
                false,
                null,
                true,
                LegendPosition.Top
            );
        }

        public update(options: VisualUpdateOptions): void {
            this.clear();

            if (!options
                || !options.dataViews
                || !options.dataViews[0]
                || !options.dataViews[0].matrix
                || !options.dataViews[0].matrix.rows
                || !options.dataViews[0].matrix.rows.root
                || !options.dataViews[0].matrix.rows.root.children
                || !options.dataViews[0].matrix.rows.root.children.length
                || !options.dataViews[0].matrix.columns
                || !options.dataViews[0].matrix.columns.root
                || !options.dataViews[0].matrix.columns.root.children
                || !options.dataViews[0].matrix.columns.root.children.length
            ) {
                return;
            }

            this.viewport = options.viewport;

            this.settings = this.parseSettings(options.dataViews[0], this.colorHelper);

            const formatter: IValueFormatter = valueFormatter.create({
                value: this.settings.tooltip.displayUnits,
                precision: this.settings.tooltip.precision,
                cultureSelector: this.visualHost.locale
            });

            this.data = this.convert(
                options.dataViews[0],
                this.colorPalette,
                this.colorHelper,
                this.visualHost,
                formatter,
            );

            const selection: d3.Selection<SunburstDataPoint> = this.render(this.colorHelper);

            if (this.data) {
                this.legendData = Sunburst.createLegend(this.data, this.settings);

                this.renderLegend();
            }

            if (this.settings.legend.show) {
                this.chartWrapper.style({
                    width: PixelConverter.toString(this.viewport.width),
                    height: PixelConverter.toString(this.viewport.height)
                });
            } else {
                this.chartWrapper.attr("style", null);
            }

            if (this.interactivityService) {
                const behaviorOptions: BehaviorOptions = {
                    selection,
                    clearCatcher: this.svg,
                    interactivityService: this.interactivityService,
                    onSelect: this.onVisualSelection.bind(this),
                    dataPoints: this.data.dataPoints,
                };

                this.interactivityService.bind(
                    this.data.dataPoints,
                    this.behavior,
                    behaviorOptions,
                );

                this.behavior.renderSelection(false);
            }
        }

        public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstanceEnumeration {
            const instanceEnumeration: VisualObjectInstanceEnumeration = SunburstSettings.enumerateObjectInstances(
                this.settings || SunburstSettings.getDefault(),
                options
            );

            if (options.objectName === Sunburst.LegendPropertyIdentifier.objectName) {
                const topCategories: SunburstDataPoint[] = this.data.root.children;
                this.enumerateColors(topCategories, instanceEnumeration);
            }

            return instanceEnumeration || [];
        }

        private enumerateColors(topCategories: SunburstDataPoint[], instanceEnumeration: VisualObjectInstanceEnumeration): void {
            if (topCategories && topCategories.length > 0) {
                topCategories.forEach((category: SunburstDataPoint) => {
                    const displayName: string = category.name.toString();
                    const identity: ISelectionId = category.identity as ISelectionId;

                    this.addAnInstanceToEnumeration(instanceEnumeration, {
                        displayName,
                        objectName: Sunburst.LegendPropertyIdentifier.objectName,
                        selector: ColorHelper.normalizeSelector(identity.getSelector(), false),
                        properties: {
                        fill: { solid: { color: 'black'/*category.color*/ } }
                        }
                    });

                    this.enumerateColors(category.children, instanceEnumeration);
                });
            }
        }

        private addAnInstanceToEnumeration(
            instanceEnumeration: VisualObjectInstanceEnumeration,
            instance: VisualObjectInstance
        ): void {

            if ((instanceEnumeration as VisualObjectInstanceEnumerationObject).instances) {
                (instanceEnumeration as VisualObjectInstanceEnumerationObject)
                    .instances
                    .push(instance);
            } else {
                (instanceEnumeration as VisualObjectInstance[]).push(instance);
            }
        }

        private static labelShift: number = 26;

        private render(colorHelper: ColorHelper): d3.Selection<SunburstDataPoint> {
            const self: Sunburst = this;

            const partition: d3.layout.Partition<d3.layout.partition.Node> = d3.layout.partition()
                .size([2 * Math.PI, Sunburst.OuterRadius * Sunburst.OuterRadius])
                .value((d: d3.layout.partition.Node) => {
                    return 1;//d.value;
                })
                .sort(null);

            const pathSelection: d3.selection.Update<SunburstDataPoint> = this.main.datum<SunburstDataPoint>(this.data.root)
                .selectAll("path")
                .data<SunburstDataPoint>(<any>partition.nodes);
                    
            pathSelection
                .enter()
                .append("path")
                .classed(this.appCssConstants.slice.className, true)
                .style("display", (slice: SunburstDataPoint) => slice.depth ? null : "none")
                .attr("d", this.arc)
                .style({
                    "fill": (slice: SunburstDataPoint) => colorHelper.isHighContrast
                        ? null
                        : slice.color,
                    "stroke": (slice: SunburstDataPoint) => colorHelper.isHighContrast
                        ? slice.color
                        : null,
                    "stroke-width": colorHelper.isHighContrast
                        ? PixelConverter.toString(2)
                        : null,
                });

            if (this.settings.group.showDataLabels) {
                pathSelection.each(function (d: SunburstDataPoint, i: number) {
                    if (!d.depth) {
                        return;
                    }

                    const firstArcSection: RegExp = /(^.+?)L/;
                    const currentSelection: d3.Selection<any> = d3.select(this);
                    const arcRegExpArray: RegExpExecArray = firstArcSection.exec(currentSelection.attr("d"));

                    // if slice is section
                    if (arcRegExpArray) {
                        let newArc: string = arcRegExpArray[1];
                        newArc = newArc.replace(/,/g, " ");
                        self.main.append("path")
                            .classed(self.appCssConstants.sliceHidden.className, true)
                            .attr("id", "sliceLabel_" + i)
                            .attr("d", newArc);
                    } else {
                        currentSelection
                            .attr("id", "sliceLabel_" + i);
                    }
                });

                this.smallestCapabablityFontSize = null; // should be recalculated below
                let labelArc = this.arc;
                var x = d3.scale.linear()
                .range([Math.PI/2, 2.5 * Math.PI]);
                var degx = d3.scale.linear()
                .range([-90, 270]);
                let radius = Sunburst.OuterRadius;
                var y = d3.scale.linear()
                .range([0, radius]);
                var cloneFunc = this.cloneObj;
                var all = this.main.selectAll(this.appCssConstants.sliceLabel.selectorName)
                    .data<SunburstDataPoint>(<any>partition.nodes)
                    .enter()
                    .append("text")
                    .style("fill", colorHelper.getHighContrastColor("foreground", null))
                    .classed(this.appCssConstants.sliceLabel.className, true);

                    // font size + slice padding
                    //const TEXT_COLOR = "lightgrey";
                    const TEXT_COLOR_OUTER = this.settings.sliceoutersettings.slicefontcolour;
                    const TEXT_SIZE_OUTER = this.settings.sliceoutersettings.fontSize;
                    const TEXT_COLOR_MIDDLE = this.settings.slicemiddlesettings.slicefontcolour;
                    const TEXT_SIZE_MIDDLE = this.settings.slicemiddlesettings.fontSize;
                    all
                    .filter((d,i,o):boolean => {
                        return (d.depth == 3);
                    })
                    .attr("transform", function(d,i,o):any {
                        // if (d.depth != 3) { return ""; }
                        const ang = (d.x + d.dx/2);
                        var deg = 180 * ang / Math.PI - 90;
                        // if (deg > 90) { deg = deg - 180; }
                        var p = cloneFunc(d);
                        //p.y = p.y - p.dy;
                        const delta = 3;
                        const dx = delta*Math.cos(ang);
                        const dy = delta*Math.sin(ang);
                        var cx = labelArc.centroid(p)[0] + dx;
                        var cy = labelArc.centroid(p)[1] + dy;
                        var rotate = "";
                        if (d.depth == 3) {
                            console.log(d.name + " - " + d.parent.name + " - " + d.parent.parent.name + " d.x: " + d.x + " deg: " + deg);
                            rotate = " rotate(" + deg + ") ";
                        }
                        return "translate(" + cx +"," + cy +")" + rotate;
                    })
                    .text((dataPoint: SunburstDataPoint) => dataPoint.name)
                    .attr("fill", TEXT_COLOR_OUTER)
                    // Font size for the outer ring
                    .style("font-size", TEXT_SIZE_OUTER);

                    // add textPath to all nodes
                    all
                    .attr("dy", Sunburst.labelShift)
                    .append("textPath")
                    .attr("fill", TEXT_COLOR_MIDDLE)
                    .attr("startOffset", "50%")
                    .attr("xlink:href", (d, i) => "#sliceLabel_" + i)
                    .text((dataPoint: SunburstDataPoint) => dataPoint.name)
                    .filter((d:any,i,o):boolean => {
                        return (d.depth == 2); // capabilities only
                    })
                    .each(this.wrapPathText(5))
                    // Font size of the middle ring
                    //.attr("font-size", this.smallestCapabablityFontSize); // variable 'smallestCapabablityFontSize' is assigned in this.wrapPathText()
                    .attr("font-size", TEXT_SIZE_MIDDLE);
                    console.log("smallestCapabablityFontSize: " + this.smallestCapabablityFontSize);
                    
                    // remove textPath from Element nodes (depth = 3), because this is the only way filtering works properly on the hierarchy
                    all
                    .filter((d:any,i,o):boolean => {
                        return (d.depth == 3);
                    })
                    .attr("dy",null)
                    .select("textPath")
                    .remove();
            }

            this.renderTooltip(pathSelection);
            this.setCategoryLabelPosition(self.viewport.width);
            this.setPercentageLabelPosition(self.viewport.width);

            pathSelection
                .exit()
                .remove();

            return pathSelection;
        }

        private cloneObj(obj: any): any {
            var newObj = {};
            for (var attr in obj) {
                newObj[attr] = obj[attr];
            }
            return newObj;
        }

        private onVisualSelection(dataPoint: SunburstDataPoint): void {
            const isSelected: boolean = !!(dataPoint && dataPoint.selected);

            this.toggleLabels(isSelected);

            // if (!isSelected) {
            //     return;
            // }

            // const percentage: string = this.getFormattedValue(dataPoint.total / this.data.total, this.percentageFormatter);
            // this.percentageLabel.data([percentage]);
            // this.percentageLabel.style("fill", dataPoint.color);
            // this.selectedCategoryLabel.data([dataPoint ? dataPoint.tooltipInfo[0].displayName : ""]);
            // this.selectedCategoryLabel.style("fill", dataPoint.color);
            // this.calculateLabelPosition();
        }

        private convert(
            dataView: DataView,
            colorPalette: IColorPalette,
            colorHelper: ColorHelper,
            visualHost: IVisualHost,
            formatter: IValueFormatter
        ): SunburstData {
            const data: SunburstData = {
                total: 0,
                root: null,
                dataPoints: [],
            };

            this.maxLevels = 0;

            data.root = this.covertTreeNodeToSunBurstDataPoint(
                dataView.matrix.rows.root,
                null,
                colorPalette,
                colorHelper,
                [],
                data,
                undefined,
                visualHost,
                1,
                formatter,
            );

            return data;
        }

        private maxLevels: number = 0;

        public covertTreeNodeToSunBurstDataPoint(
            originParentNode: DataViewTreeNode,
            sunburstParentNode: SunburstDataPoint,
            colorPalette: IColorPalette,
            colorHelper: ColorHelper,
            pathIdentity: DataViewScopeIdentity[],
            data: SunburstData,
            color: string,
            visualHost: IVisualHost,
            level: number,
            formatter: IValueFormatter,
        ): SunburstDataPoint {

            if (originParentNode.identity) {
                pathIdentity = pathIdentity.concat([originParentNode.identity]);
            }
            if (this.maxLevels < level) {
                this.maxLevels = level;
            }

            const selectionIdBuilder: visuals.ISelectionIdBuilder = visualHost.createSelectionIdBuilder();

            pathIdentity.forEach((identity: DataViewScopeIdentity) => {
                const categoryColumn: DataViewCategoryColumn = {
                    source: {
                        displayName: null,
                        queryName: identity.key
                    },
                    values: null,
                    identity: [identity]
                };

                selectionIdBuilder.withCategory(categoryColumn, 0);
            });

            const identity: ISelectionId = selectionIdBuilder.createSelectionId();

            const valueToSet: number = originParentNode.values
                ? <number>originParentNode.values[0].value
                : 0;

            const originParentNodeValue: PrimitiveValue = originParentNode.value;

            const name: string = originParentNodeValue != null
             ? `${originParentNodeValue}`
             : "";

            const newDataPointNode: SunburstDataPoint = {
                name,
                identity,
                selected: false,
                value: Math.max(valueToSet, 0),
                key: identity
                    ? identity.getKey()
                    : null,
                total: valueToSet,
                children: []
            };

            // 'if' statement commented out because it kept capability nodes selected even after selection has changed
            // Previous intent: see commit b541bf4 11-Dec-2018 'Data rendering: all elements rendered equal in size'
            // // Add the data point to the data.dataPoints collection when it has a non-zero value only
            // if (newDataPointNode.value > 0) {
                data.dataPoints.push(newDataPointNode);
                data.total += newDataPointNode.value;
            // }
            newDataPointNode.children = [];

            // if (name && level === 2 && !originParentNode.objects) {
            //     const color: string = colorHelper.getHighContrastColor(
            //         "foreground",
            //         colorPalette.getColor(name).value,
            //     );

            //     newDataPointNode.color = color;
            // } else {
            //     newDataPointNode.color = color;
            // }

            // Risk: level = 2
            // Capability: level = 3
            // Element: level = 4
            const RSK_LEVEL = 2;
            const CAP_LEVEL = 3;
            const ELT_LEVEL = 4;
            var valueNode: any = newDataPointNode;
            if (level == CAP_LEVEL) {
                const x1 = 0;
                valueNode = originParentNode.children[x1].values[0];
            } else if (level == RSK_LEVEL) {
                const ix1 = 0;//originParentNode.children.length > 1 ? 1 : 0; // Just fixes a runtime issue
                const ix2 = 0;
                valueNode = originParentNode.children[ix1].children[ix2].values[0];
            }
            var val = valueNode.value;
            if (!isNaN(val)) {
                var dataPointColor = null;
                var valuesArray = this.splitValue(val);
                if (valuesArray && valuesArray.length && valuesArray.length > 0) {
                    let elementScore = valuesArray[level - 2];
                    dataPointColor = this.getColorByValue(elementScore);
                }
                newDataPointNode.color = dataPointColor;
            }

            if (originParentNode.children && originParentNode.children.length > 0) {
                for (const child of originParentNode.children) {
                    // Skip special subtotal child node
                    if (child['isSubtotal'] == true) { 
                        continue; 
                    }
                    // const color_node: string = this.getColor(
                    //     Sunburst.LegendPropertyIdentifier,
                    //     newDataPointNode.color,
                    //     child.objects
                    // );

                    const newChild: SunburstDataPoint = this.covertTreeNodeToSunBurstDataPoint(
                        child,
                        newDataPointNode,
                        colorPalette,
                        colorHelper,
                        pathIdentity,
                        data,
                        "",
                        visualHost,
                        level + 1,
                        formatter,
                    );

                    // Add children with non-zero values only
                    if (newChild.value > 0 || newChild.total > 0) {
                        //newChild.value = 1;
                        newDataPointNode.children.push(newChild);
                        newDataPointNode.total += newChild.total;
                    }
                }
            }

            newDataPointNode.tooltipInfo = this.getTooltipData(
                formatter,
                name,
                newDataPointNode.total
            );

            if (sunburstParentNode) {
                newDataPointNode.parent = sunburstParentNode;
            }

            return newDataPointNode;
        }

        private getColor(
            properties: DataViewObjectPropertyIdentifier,
            defaultColor: string,
            objects: DataViewObjects): string {

            const colorHelper: ColorHelper = new ColorHelper(
                this.colorPalette,
                properties,
                defaultColor
            );

            return colorHelper.getColorForMeasure(objects, "", "foreground");
        }

        private getTooltipData(
            formatter: IValueFormatter,
            displayName: string,
            value: number
        ): VisualTooltipDataItem[] {
            return [{
                displayName,
                // remove the number from the toopltip as it is confusing for the purpose of this sunburst
                //value: null //this.getFormattedValue(value, formatter)
                value: this.getFormattedValue(value, formatter)
            }];
        }

        public getFormattedValue(value: number, formatter: IValueFormatter): string {
            return value < 0
                ? ""
                : formatter.format(value);
        }

        private parseSettings(dataView: DataView, coloHelper: ColorHelper): SunburstSettings {
            const settings: SunburstSettings = SunburstSettings.parse<SunburstSettings>(dataView);

            settings.legend.labelColor = this.colorHelper.getHighContrastColor("foreground", settings.legend.labelColor);

            return settings;
        }

        private static createLegend(data: SunburstData, settings: SunburstSettings): LegendData {
            const rootCategory: SunburstDataPoint[] = data.root.children;

            const legendData: LegendData = {
                fontSize: settings.legend.fontSize,
                dataPoints: [],
                title: settings.legend.showTitle ? (settings.legend.titleText) : null,
                labelColor: settings.legend.labelColor
            };

            legendData.dataPoints = rootCategory.map((dataPoint: SunburstDataPoint) => {
                return {
                    label: dataPoint.name as string,
                    color: dataPoint.color,
                    icon: LegendIcon.Circle,
                    selected: false,
                    identity: dataPoint.identity
                };
            });
            return legendData;
        }

        private calculateLabelPosition(): void {
            const innerRadius: number = Math.min.apply(
                null,
                this.data.root.children.map((x: SunburstDataPoint) => this.arc.innerRadius()(x, undefined))
            );

            this.setPercentageLabelPosition(innerRadius);
            this.setCategoryLabelPosition(innerRadius);
        }

        private setCategoryLabelPosition(width: number): void {
            const self = this;
            if (this.settings.group.showSelected) {
                if (this.selectedCategoryLabel) {
                    const labelSize: number = this.settings.group.fontSize;
                    this.selectedCategoryLabel  
                        .attr(CssConstants.transformProperty, translate(0, labelSize * -Sunburst.CategoryLineInterval))
                        .style("font-size", PixelConverter.toString(labelSize))
                        .text((x: string) => x).each(function (d: string) { self.wrapText(d3.select(this), Sunburst.DefaultDataLabelPadding, width); });
                }
            }
            else {
                this.selectedCategoryLabel.classed(this.appCssConstants.labelVisible.className, false);
            }
        }

        private setPercentageLabelPosition(width: number): void {
            const self = this;
            const labelSize: number = this.settings.group.fontSize * Sunburst.PercentageFontSizeMultiplier;
            const labelTransform: number = labelSize *
                (this.settings.group.showSelected ?
                    Sunburst.MultilinePercentageLineInterval :
                    Sunburst.DefaultPercentageLineInterval);
            this.percentageLabel
                .attr(CssConstants.transformProperty, translate(0, labelTransform))
                .style("font-size", PixelConverter.toString(labelSize))
                .text((x: string) => x).each(function (d: string) { self.wrapText(d3.select(this), Sunburst.DefaultDataLabelPadding, width); });
        }

        private renderTooltip(selection: d3.selection.Update<TooltipEnabledDataPoint>): void {
            if (!this.tooltipService) {
                return;
            }

            this.tooltipService.addTooltip(selection, (tooltipEvent: TooltipEventArgs<SunburstDataPoint>) => {
                return tooltipEvent.data.tooltipInfo;
            });
        }

        private renderLegend(): void {
            if (!this.data) {
                return;
            }

            const position: LegendPosition = this.settings.legend.show
                ? LegendPosition[this.settings.legend.position]
                : LegendPosition.None;

            this.legend.changeOrientation(position);
            this.legend.drawLegend(this.legendData, JSON.parse(JSON.stringify(this.viewport)));

            Legend.positionChartArea(this.chartWrapper, this.legend);

            switch (this.legend.getOrientation()) {
                case LegendPosition.Left:
                case LegendPosition.LeftCenter:
                case LegendPosition.Right:
                case LegendPosition.RightCenter:
                    this.viewport.width -= this.legend.getMargins().width;
                    break;
                case LegendPosition.Top:
                case LegendPosition.TopCenter:
                case LegendPosition.Bottom:
                case LegendPosition.BottomCenter:
                    this.viewport.height -= this.legend.getMargins().height;
                    break;
            }
        }

        private wrapPathText(padding?: number): (slice: SunburstDataPoint, index: number) => void {
            const self = this;
            return function (slice: SunburstDataPoint, index: number) {
                if (!slice.depth) {
                    return;
                }
                const selection: d3.Selection<any> = d3.select(this);
                const width = (<SVGPathElement>d3.select(selection.attr("xlink:href")).node()).getTotalLength();
                const fontSize:number = self.wrapText(selection, padding, width);
                // update the global font size variable
                const MIN_FONT_SIZE: number = 6;
                const minSize = Math.min(fontSize, self.smallestCapabablityFontSize);
                const calculatedFontSize = Math.max(MIN_FONT_SIZE, minSize);
                self.smallestCapabablityFontSize = self.smallestCapabablityFontSize == null ? fontSize : calculatedFontSize;
            };
        }

        private wrapText(selection: d3.Selection<any>, padding?: number, width?: number): number {
            let node: SVGTextElement = <SVGTextElement>selection.node(),
                textLength: number = node.getComputedTextLength(),
                fontSize: number = window.getComputedStyle(node).fontSize != null ? parseInt(window.getComputedStyle(node).fontSize) : this.settings.group.fontSize,
                text: string = selection.text();
            width = width || 0;
            padding = padding || 0;
            while (textLength > (width - 2 * padding) && text.length > 0) {
                // debugger;
                //text = text.slice(0, -1);
                //selection.text(text + "\u2026");
                fontSize = fontSize - 1;
                selection.attr("font-size", fontSize)
                textLength = node.getComputedTextLength();
            }
            if (textLength > (width - 2 * padding)) {
                selection.text("");
            }
            return fontSize;
        }

        private clear(): void {
            this.main
                .selectAll("*")
                .remove();
        }

        private getColorByValue(value: number = null){
            // Set the colours used for each level 1-4
            var myColors = [this.settings.ratingcolors.color1, this.settings.ratingcolors.color2, this.settings.ratingcolors.color3, this.settings.ratingcolors.color4];
            var colorIndex = value != null && value > 0 && value <= myColors.length ? Math.floor(value - 1) : null;
            return colorIndex != null ? myColors[colorIndex] : null;
        }

        private splitValue(value: number = null) {
            var arReturn = [];
            if (value != null) {
                const strVal = value.toString();
                for (var i = 0; i < strVal.length; i++) {
                    var c = strVal.charAt(i);
                    var n = parseInt(c);
                    arReturn.push(n);
                }
            }
            return arReturn;
        }
}
}
