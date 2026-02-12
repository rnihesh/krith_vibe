/// <reference types="vite/client" />

declare module "d3-force-clustering" {
  function forceClustering(): {
    (alpha: number): void;
    initialize(nodes: any[], ...args: any[]): void;
    clusterId(fn: (d: any) => any): any;
    strength(v: number | ((id: any, nodes: any[]) => number)): any;
    weight(v: number | ((d: any) => number)): any;
    distanceMin(v: number): any;
  };
  export default forceClustering;
}
