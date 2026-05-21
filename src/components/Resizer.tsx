import React from "react";

interface ResizerProps {
  orientation: "horizontal" | "vertical";
  onResize: (deltaPx: number) => void;
  onResizeEnd?: () => void;
}

export const Resizer: React.FC<ResizerProps> = ({ orientation, onResize, onResizeEnd }) => {
  const isHorizontal = orientation === "horizontal";

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let last = isHorizontal ? e.clientY : e.clientX;

    const cursorClass = isHorizontal ? "cursor-row-resize" : "cursor-col-resize";
    document.body.classList.add(cursorClass, "select-none");

    const move = (ev: PointerEvent) => {
      const current = isHorizontal ? ev.clientY : ev.clientX;
      const delta = current - last;
      last = current;
      if (delta !== 0) onResize(delta);
    };

    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      document.body.classList.remove(cursorClass, "select-none");
      onResizeEnd?.();
    };

    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  if (isHorizontal) {
    return (
      <div
        onPointerDown={onPointerDown}
        className="h-1 w-full bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 cursor-row-resize transition-colors shrink-0"
        role="separator"
        aria-orientation="horizontal"
      />
    );
  }
  return (
    <div
      onPointerDown={onPointerDown}
      className="w-1 h-full bg-slate-800 hover:bg-cyan-700 active:bg-cyan-600 cursor-col-resize transition-colors shrink-0"
      role="separator"
      aria-orientation="vertical"
    />
  );
};
