export function RouteLoadingFallback() {
  return (
    <p
      aria-live="polite"
      className="text-muted-foreground grid min-h-screen place-items-center text-sm"
      role="status"
    >
      正在加载页面…
    </p>
  );
}
