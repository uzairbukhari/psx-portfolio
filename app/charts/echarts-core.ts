// Only what the app's charts use, so the bundle stays small. Loaded on demand by `<EChart>`.
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart, TreemapChart } from 'echarts/charts';
import {
  AriaComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapContinuousComponent,
  VisualMapPiecewiseComponent,
} from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  HeatmapChart,
  TreemapChart,
  AriaComponent,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapContinuousComponent,
  VisualMapPiecewiseComponent,
  LabelLayout,
  CanvasRenderer,
]);

export { echarts };
