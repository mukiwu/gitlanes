import React, { useEffect, useMemo, useRef, useState } from "react";
import { CommitNode } from "../types";
import { GitBranch, User, Clock, Check, Maximize2, Minimize2 } from "lucide-react";

interface GitGraphLabels {
  title: string;
  emptyTitle: string;
  emptyHint: string;
  loadMore: string;
}

interface GitGraphProps {
  commits: CommitNode[];
  currentBranch: string;
  selectedCommit: CommitNode | null;
  onSelectCommit: (commit: CommitNode) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  labels: GitGraphLabels;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  maximizeTitle?: string;
}

export const GitGraph: React.FC<GitGraphProps> = ({
  commits,
  currentBranch,
  selectedCommit,
  onSelectCommit,
  hasMore = false,
  onLoadMore,
  labels,
  isMaximized = false,
  onToggleMaximize,
  maximizeTitle,
}) => {
  // NOTE: All hooks must run unconditionally and BEFORE any early return,
  // otherwise React throws "Rendered more hooks than during the previous render"
  // when `commits` transitions between empty and non-empty.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 360 });

  // Measure the real scroll-container height on mount and on resize so the
  // virtualization window covers the full visible area (a hardcoded height
  // leaves the bottom portion blank until the first scroll event fires).
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const sync = () =>
      setViewport((prev) => ({ ...prev, height: element.clientHeight }));

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Assign lanes to commits to draw clean side-by-side branch tracks
  // Simple, deterministic track assignment based on parent links
  const laneWidth = 12;
  const nodeRadius = 6;
  const rowHeight = 44;
  const paddingLeft = 16;
  const paddingTop = 20;

  const maxLane = 5;
  const laneX = (lane: number) => paddingLeft + Math.min(lane, maxLane) * laneWidth + 12;

  interface Edge {
    cx: number;
    cy: number;
    px: number;
    py: number;
    lane: number;
    childIndex: number;
    parentIndex: number;
  }

  const { commitLayouts, edges } = useMemo(() => {
    const layouts: { [hash: string]: { x: number; y: number; lane: number; index: number } } = {};
    // Each slot holds the hash of the commit a lane is currently waiting for.
    // An empty string marks a freed lane that can be reused by a new branch,
    // which keeps the graph compact instead of drifting right forever.
    const activeLanes: string[] = [];
    const claimLane = (): number => {
      const free = activeLanes.indexOf("");
      if (free !== -1) return free;
      activeLanes.push("");
      return activeLanes.length - 1;
    };

    commits.forEach((commit, index) => {
      const y = paddingTop + index * rowHeight;
      const existing = activeLanes.indexOf(commit.hash);
      const lane = existing !== -1 ? existing : claimLane();

      // Free any other lanes that were also waiting for this same commit
      // (it is the parent of more than one branch) so they can be reused.
      for (let idx = 0; idx < activeLanes.length; idx++) {
        if (idx !== lane && activeLanes[idx] === commit.hash) {
          activeLanes[idx] = "";
        }
      }

      // This lane now follows the commit's first parent; extra (merge) parents
      // claim their own lanes. A root commit frees the lane.
      if (commit.parents.length > 0) {
        activeLanes[lane] = commit.parents[0];
        for (let idx = 1; idx < commit.parents.length; idx++) {
          activeLanes[claimLane()] = commit.parents[idx];
        }
      } else {
        activeLanes[lane] = "";
      }

      layouts[commit.hash] = { x: laneX(lane), y, lane, index };
    });

    // Resolve parent links into concrete edges once, so rendering can draw
    // every edge that crosses the viewport (not only those whose child row is
    // visible) — otherwise lines spanning the window would vanish.
    const resolveParent = (parentHash: string) => {
      const exact = layouts[parentHash];
      if (exact) return exact;
      const key = Object.keys(layouts).find((h) => h.startsWith(parentHash) || parentHash.startsWith(h));
      return key ? layouts[key] : undefined;
    };

    const edges: Edge[] = [];
    commits.forEach((commit, index) => {
      const child = layouts[commit.hash];
      if (!child) return;
      commit.parents.forEach((parentHash) => {
        const parent = resolveParent(parentHash);
        if (!parent) return;
        edges.push({
          cx: child.x,
          cy: child.y,
          px: parent.x,
          py: parent.y,
          lane: child.lane,
          childIndex: index,
          parentIndex: parent.index,
        });
      });
    });

    return { commitLayouts: layouts, edges };
  }, [commits]);

  const svgHeight = commits.length * rowHeight + paddingTop * 2 - 20;
  const visibleStart = Math.max(0, Math.floor((viewport.scrollTop - paddingTop) / rowHeight) - 12);
  const visibleEnd = Math.min(commits.length, Math.ceil((viewport.scrollTop + viewport.height + paddingTop) / rowHeight) + 12);
  const visibleCommits = commits.slice(visibleStart, visibleEnd);

  const laneColors = [
    "stroke-cyan-500",
    "stroke-purple-500",
    "stroke-amber-500",
    "stroke-emerald-500",
    "stroke-rose-500",
  ];

  // Draw every edge that overlaps the visible row range so lines stay
  // continuous through the viewport, even when both endpoints are off-screen.
  const lines: React.ReactNode[] = [];
  edges.forEach((edge, idx) => {
    if (edge.parentIndex < visibleStart || edge.childIndex > visibleEnd) return;

    const { cx, cy, px, py } = edge;
    let pathData: string;
    if (px === cx) {
      pathData = `M ${cx} ${cy} L ${px} ${py}`;
    } else {
      // Short bend out of the child node into the parent's lane within the
      // first row, then a straight vertical track down to the parent.
      const bend = Math.min(rowHeight, py - cy);
      const by = cy + bend;
      pathData = `M ${cx} ${cy} C ${cx} ${cy + bend * 0.5}, ${px} ${by - bend * 0.5}, ${px} ${by} L ${px} ${py}`;
    }

    const colorClass = laneColors[edge.lane % laneColors.length];
    lines.push(
      <path
        key={`edge-${idx}`}
        d={pathData}
        fill="none"
        className={`${colorClass} stroke-2 opacity-80`}
      />
    );
  });

  if (commits.length === 0) {
    return (
      <div id="git-graph-empty" className="flex flex-col items-center justify-center p-8 py-16 text-center border border-dashed border-slate-700 rounded-lg bg-slate-900/40">
        <GitBranch className="h-10 w-10 text-slate-500 mb-3 animate-pulse" />
        <p className="text-slate-300 font-medium">{labels.emptyTitle}</p>
        <p className="text-slate-500 text-xs max-w-sm mt-1">
          {labels.emptyHint}
        </p>
      </div>
    );
  }

  return (
    <div id="git-graph-container" className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <GitBranch className="h-4 w-4 text-cyan-500" />
          <h3 className="text-slate-200 font-medium text-xs font-sans">{labels.title}</h3>
          <span className="text-[12px] text-slate-600 font-mono">{commits.length}{hasMore ? "+" : ""} commits</span>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-[12px] text-slate-500 font-mono">HEAD: {currentBranch}</span>
          {onToggleMaximize && (
            <button
              onClick={onToggleMaximize}
              title={maximizeTitle}
              className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
            >
              {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto scrollbar-thin"
        onScroll={(event) => {
          const target = event.currentTarget;
          setViewport({ scrollTop: target.scrollTop, height: target.clientHeight });
        }}
      >
        <div className="relative flex" style={{ minWidth: "900px", minHeight: `${svgHeight}px` }}>
          {/* SVG Tracks Overlay column */}
          <div className="relative" style={{ width: `${paddingLeft + 6 * laneWidth + 24}px`, minHeight: `${svgHeight}px` }}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {lines}
            </svg>

            {/* Render Nodes as absolute positioning over SVG */}
            {visibleCommits.map((commit) => {
              const layout = commitLayouts[commit.hash];
              if (!layout) return null;

              // Color assignments
              const nodeColors = [
                "bg-cyan-500 shadow-cyan-500/20",
                "bg-purple-500 shadow-purple-500/20",
                "bg-amber-500 shadow-amber-500/20",
                "bg-emerald-500 shadow-emerald-500/20",
                "bg-rose-500 shadow-rose-500/20",
              ];
              const colorClass = nodeColors[layout.lane % nodeColors.length];
              const isSelected = selectedCommit?.hash === commit.hash;
              
              return (
                <button
                  key={commit.hash}
                  onClick={() => onSelectCommit(commit)}
                  style={{
                    left: `${layout.x - nodeRadius - 2}px`,
                    top: `${layout.y - nodeRadius - 2}px`,
                    width: `${(nodeRadius + 2) * 2}px`,
                    height: `${(nodeRadius + 2) * 2}px`,
                  }}
                  title={`View details for ${commit.hash}`}
                  className={`absolute rounded-full flex items-center justify-center cursor-pointer transition-all focus:outline-none z-10 
                    ${isSelected ? "ring-4 ring-cyan-400/30 scale-125" : "hover:scale-115"}
                  `}
                >
                  <div className={`w-3 h-3 rounded-full ${colorClass} shadow-md border-2 border-slate-900`} />
                </button>
              );
            })}
          </div>

          {/* Commit labels aligned with layout.y */}
          <div className="flex-1 pr-4">
            {visibleCommits.map((commit) => {
              const layout = commitLayouts[commit.hash];
              if (!layout) return null;

              const isSelected = selectedCommit?.hash === commit.hash;
              const index = commits.findIndex((item) => item.hash === commit.hash);
              const isHead = index === 0;

              return (
                <div
                  key={commit.hash}
                  onClick={() => onSelectCommit(commit)}
                  style={{
                    height: `${rowHeight}px`,
                    top: `${layout.y - rowHeight / 2}px`,
                  }}
                  className={`absolute left-[100px] right-4 flex items-center justify-between px-3 py-1 rounded cursor-pointer transition-all border
                    ${isSelected 
                      ? "bg-slate-800/80 border-slate-700 text-slate-100 shadow-sm" 
                      : "border-transparent hover:bg-slate-800/30 text-slate-400 hover:text-slate-300"
                    }`}
                >
                  <div className="flex items-center space-x-3 overflow-hidden pr-2">
                    {/* Hash code */}
                    <span className="font-mono text-xs text-cyan-400 font-semibold select-all">
                      {commit.hash}
                    </span>

                    {/* Head tag indicator */}
                    {isHead && (
                      <span className="flex items-center space-x-0.5 bg-emerald-950 border border-emerald-800 text-emerald-400 text-[12px] px-1.5 py-0.5 rounded font-medium select-none shrink-0 uppercase">
                        <Check className="h-2.5 w-2.5" />
                        <span>HEAD</span>
                      </span>
                    )}

                    {/* Commit Message */}
                    <span className="truncate text-xs font-sans font-medium text-slate-200">
                      {commit.message}
                    </span>
                  </div>

                  {/* Date & Author right column */}
                  <div className="flex items-center space-x-4 text-[12px] text-slate-500 shrink-0 font-mono">
                    <div className="flex items-center space-x-1">
                      <User className="h-3 w-3" />
                      <span className="max-w-[70px] truncate">{commit.author}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Clock className="h-3 w-3" />
                      <span>{commit.date}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {hasMore && (
              <div
                className="absolute left-[100px] right-4 flex items-center justify-center"
                style={{ top: `${svgHeight - 34}px`, height: "32px" }}
              >
                <button
                  onClick={onLoadMore}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[12px] font-mono font-bold px-3 py-1.5 rounded border border-slate-700 cursor-pointer"
                >
                  {labels.loadMore}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
