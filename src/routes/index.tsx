import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Plus,
  AlertTriangle,
  Zap,
  Layers,
  Bot,
  Activity,
  ShieldAlert,
  Battery,
  BatteryCharging,
  CheckCircle2,
  Clock,
  Navigation,
  Compass,
  ChevronLeft,
  ChevronRight,
  Info,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { SimCanvas } from "@/components/warehouse/SimCanvas";
import { getSim, SCENARIOS } from "@/sim/engine";
import { useSimStore } from "@/sim/store";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"fleet" | "tasks" | "events">("fleet");
  const [showLogicInfo, setShowLogicInfo] = useState(false);
  const snap = useSimStore((s) => s.snap);
  const showPaths = useSimStore((s) => s.showPaths);
  const setShowPaths = useSimStore((s) => s.setShowPaths);
  const selected = useSimStore((s) => s.selected);
  const select = useSimStore((s) => s.select);
  const refresh = useSimStore((s) => s.refresh);

  useEffect(() => {
    setMounted(true);
    const sim = getSim();
    if (!sim.running) {
      sim.start();
    }
    refresh();
  }, [refresh]);

  if (!mounted) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#14181f] text-[#9aa1ab]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <span className="font-mono text-sm tracking-widest text-amber-400">INITIALIZING AISLEZERO ENGINE...</span>
        </div>
      </div>
    );
  }

  const sim = getSim();
  const narrative = snap.narrative;

  const handleTogglePlay = () => {
    if (sim.running) {
      sim.pause();
    } else {
      sim.resume();
    }
    refresh();
  };

  const handleReset = () => {
    sim.reset();
    sim.start();
    refresh();
  };

  const handleScenario = (id: number) => {
    sim.loadScenario(id);
    sim.start();
    refresh();
  };

  const handlePrevScenario = () => {
    const nextId = snap.scenario === 1 ? SCENARIOS.length : snap.scenario - 1;
    handleScenario(nextId);
  };

  const handleNextScenario = () => {
    const nextId = snap.scenario === SCENARIOS.length ? 1 : snap.scenario + 1;
    handleScenario(nextId);
  };

  const handleSpeed = (s: number) => {
    sim.setSpeed(s);
    refresh();
  };

  const handleAddTask = () => {
    sim.addRandomTask();
    refresh();
  };

  const handleAddObstacle = () => {
    sim.addObstacleNearFleet();
    refresh();
  };

  const handleToggleAisle = () => {
    sim.toggleAisle(14);
    refresh();
  };

  const handleFailToggle = (robotId: string, currentStatus: string) => {
    if (currentStatus === "failed") {
      sim.recoverRobot(robotId);
    } else {
      sim.failRobot(robotId);
    }
    refresh();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "to_pickup":
        return <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-400">TO PICKUP</span>;
      case "to_dropoff":
        return <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">CARRYING</span>;
      case "avoiding":
        return (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
            {snap.scenario === 6 ? "AVOIDING OBSTACLE" : snap.scenario === 4 ? "SIDE PATH" : "AVOIDING"}
          </span>
        );
      case "waiting":
        return <span className="rounded bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">WAITING</span>;
      case "charging":
        return <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs font-medium text-cyan-400">CHARGING</span>;
      case "failed":
        return (
          <span className="rounded bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-xs font-bold text-rose-400 animate-pulse">
            E-STOP FAULT
          </span>
        );
      default:
        return <span className="rounded bg-zinc-700/50 px-2 py-0.5 text-xs font-medium text-zinc-400">IDLE</span>;
    }
  };

  const pendingTasks = snap.tasks.filter((t) => t.status === "pending");
  const inProgressTasks = snap.tasks.filter((t) => t.status === "assigned" || t.status === "carrying");
  const doneTasks = snap.tasks.filter((t) => t.status === "done");

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#12161c] text-[#e5e9f0] select-none">
      {/* 3D Simulation Canvas */}
      <div className="absolute inset-0">
        <SimCanvas />
      </div>

      {/* Top Header Bar */}
      <header className="absolute top-0 left-0 right-0 z-20 flex h-14 items-center justify-between border-b border-[#2d3542]/80 bg-[#161b24]/90 px-5 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display text-lg font-bold tracking-wider text-white">AISLE ZERO</span>
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-mono tracking-widest text-amber-300">
                  VITE 3D FLEET
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-400">AUTONOMOUS MOBILE ROBOT DISPATCH</p>
            </div>
          </div>

          <div className="h-6 w-px bg-zinc-800" />

          {/* Scenario Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-zinc-400">SCENARIO:</span>
            <select
              value={snap.scenario}
              onChange={(e) => handleScenario(Number(e.target.value))}
              aria-label="Simulation scenario"
              className="rounded-md border border-[#333d4e] bg-[#1a202c] px-2.5 py-1 text-xs font-medium text-zinc-200 outline-none hover:border-amber-500/50 focus:border-amber-500 transition-colors"
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}. {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Global Controls & Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-[#2e3745] bg-[#1a202b] px-3 py-1">
            <div className={`h-2 w-2 rounded-full ${snap.running ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            <span className="font-mono text-xs text-zinc-300">
              {snap.running ? "ACTIVE" : "PAUSED"}
            </span>
            <span className="font-mono text-xs text-amber-400/90 font-semibold ml-1">
              T+{snap.time.toFixed(1)}s
            </span>
          </div>

          {/* Play/Pause Button */}
          <button
            onClick={handleTogglePlay}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              snap.running
                ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40"
                : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm"
            }`}
          >
            {snap.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {snap.running ? "Pause" : "Run"}
          </button>

          {/* Reset */}
          <button
            onClick={handleReset}
            title="Reset Simulation"
            className="flex items-center gap-1.5 rounded-md border border-[#333d4e] bg-[#1a202c] px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-[#252e3e] transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>

          {/* Speed Selector */}
          <div className="flex items-center rounded-md border border-[#333d4e] bg-[#1a202c] p-0.5 text-xs font-mono">
            {[1, 2, 4].map((spd) => (
              <button
                key={spd}
                onClick={() => handleSpeed(spd)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  sim.speed === spd ? "bg-amber-500 text-zinc-950 font-bold" : "text-zinc-400 hover:text-white"
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          {/* Overlay Toggle */}
          <button
            onClick={() => setShowPaths(!showPaths)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              showPaths
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-[#333d4e] bg-[#1a202c] text-zinc-400 hover:text-white"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Paths
          </button>
        </div>
      </header>

      {/* Top Left/Center: Scenario Director & Real-Time Narrative HUD ("The Liner") */}
      <div className="absolute top-18 left-5 right-[416px] z-20 flex flex-col gap-2 pointer-events-auto">
        <div className="rounded-xl border border-[#2d3648]/90 bg-[#141923]/95 p-3 shadow-2xl backdrop-blur-md">
          {/* Header row: Scenario Tag, Controls, and Navigation */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#252f40] pb-2">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1">
                <button
                  onClick={handlePrevScenario}
                  title="Previous Scenario"
                  className="flex h-6 w-6 items-center justify-center rounded border border-[#333e52] bg-[#1a2230] text-zinc-300 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/50 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={handleNextScenario}
                  title="Next Scenario"
                  className="flex h-6 w-6 items-center justify-center rounded border border-[#333e52] bg-[#1a2230] text-zinc-300 hover:bg-amber-500/20 hover:text-amber-300 hover:border-amber-500/50 transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-amber-300 border border-amber-500/30">
                  SCENARIO {String(snap.scenario).padStart(2, "0")} / 08
                </span>
                <span className="font-display text-sm font-bold text-white tracking-wide">
                  {narrative?.title || SCENARIOS[snap.scenario - 1]?.name}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLogicInfo(!showLogicInfo)}
                className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-mono transition-colors ${
                  showLogicInfo
                    ? "bg-amber-500 text-zinc-950 font-bold"
                    : "border border-[#333e52] bg-[#1a2230] text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Info className="h-3 w-3" />
                <span>{showLogicInfo ? "Hide Logic" : "Scenario Logic"}</span>
              </button>
            </div>
          </div>

          {/* Real-Time Live Status Liner ("The Liner") */}
          <div className="mt-2 flex items-start gap-2.5 rounded-lg border border-[#2b3547] bg-[#10141d]/90 p-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  LIVE NARRATIVE // STATUS
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              </div>
              <p className="mt-0.5 text-xs font-mono text-zinc-200 leading-relaxed font-medium">
                {narrative?.currentLiner || "Simulation running..."}
              </p>
            </div>
          </div>

          {/* Interactive Step Pipeline */}
          {narrative?.steps && narrative.steps.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#222b3b]">
              <span className="text-[10px] font-mono text-zinc-400 uppercase font-semibold mr-1">
                STEPS:
              </span>
              {narrative.steps.map((step, idx) => (
                <div key={step.id} className="flex items-center gap-1.5">
                  <div
                    className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-mono transition-all ${
                      step.status === "completed"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : step.status === "active"
                          ? "bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-sm shadow-amber-500/20 font-bold animate-pulse"
                          : "bg-zinc-800/40 text-zinc-400 border border-zinc-700/30"
                    }`}
                  >
                    {step.status === "completed" ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <span className="text-[9px] font-bold opacity-75">{step.id}.</span>
                    )}
                    <span>{step.label}</span>
                  </div>
                  {idx < narrative.steps.length - 1 && (
                    <ArrowRight className="h-2.5 w-2.5 text-zinc-600" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Active Callout Alert Banner (e.g. Collision Red Zone / Priority Decided) */}
          {narrative?.alert && (
            <div
              className={`mt-2 flex items-start gap-2 rounded-lg border p-2 text-xs font-mono transition-all ${
                narrative.alert.type === "danger"
                  ? "border-rose-500/50 bg-rose-950/40 text-rose-200"
                  : narrative.alert.type === "warning"
                    ? "border-amber-500/50 bg-amber-950/40 text-amber-200"
                    : narrative.alert.type === "success"
                      ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-200"
                      : "border-sky-500/50 bg-sky-950/40 text-sky-200"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold uppercase tracking-wider">{narrative.alert.title}:</span>{" "}
                <span>{narrative.alert.text}</span>
              </div>
            </div>
          )}

          {/* Expandable Scenario Logic Drawer */}
          {showLogicInfo && (
            <div className="mt-2.5 rounded-lg border border-[#333e52] bg-[#10141d] p-2.5 text-xs font-mono text-zinc-300 space-y-1.5">
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">
                ENGINEERING LOGIC & ALGORITHM RULES:
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {narrative?.subtitle}
              </p>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-400 pt-1 border-t border-[#222a38]">
                {snap.scenario === 6 ? (
                  <>
                    <div>
                      <span className="text-zinc-200 font-semibold">LiDAR Zone:</span> 360° LiDAR envelope (0.75m radius)
                    </div>
                    <div>
                      <span className="text-zinc-200 font-semibold">Avoidance Protocol:</span> Dynamic A* detour around pedestrians & pallets
                    </div>
                  </>
                ) : snap.scenario === 7 ? (
                  <>
                    <div>
                      <span className="text-zinc-200 font-semibold">Fault Protocol:</span> Hardware fault trigger + Safe E-Stop isolation
                    </div>
                    <div>
                      <span className="text-zinc-200 font-semibold">Fleet Continuity:</span> Dynamic replanning around disabled unit
                    </div>
                  </>
                ) : snap.scenario === 8 ? (
                  <>
                    <div>
                      <span className="text-zinc-200 font-semibold">Revocation Trigger:</span> In-flight mission revocation upon AMR fault
                    </div>
                    <div>
                      <span className="text-zinc-200 font-semibold">Reallocation Arbiter:</span> Instant scoring & dispatch to healthy AMR
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <span className="text-zinc-200 font-semibold">Priority Arbiter:</span> Urgency(10×) + Cargo(5×) + Batt(0.1×)
                    </div>
                    <div>
                      <span className="text-zinc-200 font-semibold">Avoidance Protocol:</span> MAPF A* Detour via open vertical lanes
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick Action Controls Toolbar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#2d3542]/80 bg-[#161b24]/90 p-1.5 backdrop-blur-md shadow-xl">
          <button
            onClick={handleAddTask}
            className="flex items-center gap-1.5 rounded-md bg-[#222a36] px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-[#2b3544] border border-[#374254] transition-colors"
          >
            <Plus className="h-3 w-3 text-amber-400" />
            + Task
          </button>
          <button
            onClick={handleAddObstacle}
            className="flex items-center gap-1.5 rounded-md bg-[#222a36] px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-[#2b3544] border border-[#374254] transition-colors"
          >
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            + Dynamic Obstacle
          </button>
          <button
            onClick={handleToggleAisle}
            className="flex items-center gap-1.5 rounded-md bg-[#222a36] px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-[#2b3544] border border-[#374254] transition-colors"
          >
            <ShieldAlert className="h-3 w-3 text-rose-400" />
            Toggle Aisle 14 Block
          </button>
        </div>
      </div>

      {/* Camera Guidance Prompt */}
      <div className="absolute bottom-4 left-5 z-10 rounded-md border border-[#2d3542]/70 bg-[#161b24]/80 px-3 py-1.5 text-[11px] font-mono text-zinc-400 backdrop-blur-sm pointer-events-none">
        <span className="text-amber-400">Orbit:</span> Left Click + Drag | <span className="text-amber-400">Pan:</span> Right Click + Drag | <span className="text-amber-400">Zoom:</span> Scroll
      </div>

      {/* Right Telemetry & Operations Panel */}
      <div className="absolute top-18 right-5 bottom-4 z-20 flex w-96 flex-col overflow-hidden rounded-xl border border-[#2e3746] bg-[#161b24]/95 shadow-2xl backdrop-blur-md">
        {/* Panel Tabs */}
        <div className="flex border-b border-[#2e3746] bg-[#131720]">
          <button
            onClick={() => setActiveTab("fleet")}
            className={`flex-1 py-2.5 text-center text-xs font-semibold tracking-wider transition-colors ${
              activeTab === "fleet"
                ? "border-b-2 border-amber-500 bg-[#1a202c] text-amber-400"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            FLEET ({snap.robots.length})
          </button>
          <button
            onClick={() => setActiveTab("tasks")}
            className={`flex-1 py-2.5 text-center text-xs font-semibold tracking-wider transition-colors ${
              activeTab === "tasks"
                ? "border-b-2 border-amber-500 bg-[#1a202c] text-amber-400"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            TASKS ({snap.tasks.length})
          </button>
          <button
            onClick={() => setActiveTab("events")}
            className={`flex-1 py-2.5 text-center text-xs font-semibold tracking-wider transition-colors ${
              activeTab === "events"
                ? "border-b-2 border-amber-500 bg-[#1a202c] text-amber-400"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            LOGS ({snap.events.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 font-sans">
          {activeTab === "fleet" && (
            <div className="space-y-3">
              {snap.robots.map((robot) => {
                const isSelected = selected === robot.id;
                const batteryColor =
                  robot.battery > 50
                    ? "bg-emerald-500"
                    : robot.battery > 20
                      ? "bg-amber-500"
                      : "bg-rose-500";

                return (
                  <div
                    key={robot.id}
                    onClick={() => select(robot.id)}
                    className={`rounded-lg border p-3 transition-all cursor-pointer ${
                      isSelected
                        ? "border-amber-500/60 bg-[#1d2432] shadow-md ring-1 ring-amber-500/30"
                        : "border-[#2c3545] bg-[#181f2a]/90 hover:border-zinc-500"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded bg-amber-500/10 text-amber-400 font-mono font-bold text-xs">
                          {robot.id}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-white">{robot.name}</div>
                          <div className="text-[10px] font-mono text-zinc-400">
                            Grid ({robot.pos.x.toFixed(1)}, {robot.pos.y.toFixed(1)})
                          </div>
                        </div>
                      </div>
                      {getStatusBadge(robot.status)}
                    </div>

                    {/* Battery Bar */}
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                        <span className="flex items-center gap-1">
                          {robot.status === "charging" ? (
                            <BatteryCharging className="h-3 w-3 text-cyan-400" />
                          ) : (
                            <Battery className="h-3 w-3" />
                          )}
                          Battery
                        </span>
                        <span className="text-zinc-200">{Math.round(robot.battery)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${batteryColor}`}
                          style={{ width: `${Math.max(4, robot.battery)}%` }}
                        />
                      </div>
                    </div>

                    {/* Current Mission & Stats */}
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#2a3241] pt-2 text-[10px] font-mono text-zinc-300">
                      <div>
                        <span className="text-zinc-400">MISSION:</span>{" "}
                        <span className="text-amber-300 font-semibold">{robot.taskId || "None"}</span>
                      </div>
                      <div>
                        <span className="text-zinc-400">CARGO:</span>{" "}
                        <span className={robot.carrying ? "text-emerald-400 font-bold" : "text-zinc-400"}>
                          {robot.carrying ? "Loaded" : "Empty"}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-400">DELIVERED:</span> {robot.tasksDone}
                      </div>
                      <div>
                        <span className="text-zinc-400">REROUTES:</span> {robot.reroutes}
                      </div>
                    </div>

                    {/* Action Controls for this Robot */}
                    <div className="mt-2.5 flex items-center justify-between border-t border-[#2a3241] pt-2">
                      <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[170px]" title={robot.lastEvent}>
                        {robot.lastEvent}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFailToggle(robot.id, robot.status);
                        }}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                          robot.status === "failed"
                            ? "bg-emerald-600 text-white hover:bg-emerald-500"
                            : "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 border border-rose-500/40"
                        }`}
                      >
                        {robot.status === "failed" ? "Recover" : "Inject Fault"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "tasks" && (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 px-1">
                <span>QUEUE OVERVIEW</span>
                <span>
                  {inProgressTasks.length} active / {pendingTasks.length} pending
                </span>
              </div>

              {snap.tasks.length === 0 ? (
                <div className="py-8 text-center text-zinc-400 font-mono text-xs">
                  No active tasks. Click "+ Task" to dispatch.
                </div>
              ) : (
                snap.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-md border border-[#2b3444] bg-[#181f2a] p-2.5 text-zinc-300"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-amber-400">{task.id}</span>
                        {task.reassignments > 0 && (
                          <span className="rounded bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                            REALLOCATED ({task.reassignments}×)
                          </span>
                        )}
                      </div>
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] uppercase font-mono ${
                          task.status === "done"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : task.status === "carrying"
                              ? "bg-sky-500/20 text-sky-400"
                              : task.status === "assigned"
                                ? "bg-amber-500/20 text-amber-400"
                                : "bg-zinc-700/50 text-zinc-400"
                        }`}
                      >
                        {task.status}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <span>Pick ({task.pickup.x}, {task.pickup.y})</span>
                      <span>→</span>
                      <span>Drop ({task.dropoff.x}, {task.dropoff.y})</span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between border-t border-[#27303d] pt-1 text-[10px] font-mono">
                      <span className="text-zinc-400">Assigned: {task.assignedTo || "Unassigned"}</span>
                      <span className="text-amber-400/80">Priority: Lv.{task.urgency}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "events" && (
            <div className="space-y-1.5 font-mono text-[11px]">
              {snap.events.length === 0 ? (
                <div className="py-8 text-center text-zinc-400">No events logged yet.</div>
              ) : (
                snap.events.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-start gap-2 rounded border border-[#262f3c] bg-[#171d27] p-2"
                  >
                    <span className="text-zinc-400 shrink-0">+{ev.t.toFixed(1)}s</span>
                    <span
                      className={`font-semibold shrink-0 uppercase text-[10px] ${
                        ev.kind === "failure"
                          ? "text-rose-400"
                          : ev.kind === "conflict"
                            ? "text-amber-400"
                            : ev.kind === "delivery"
                              ? "text-emerald-400"
                              : ev.kind === "reroute"
                                ? "text-sky-400"
                                : "text-zinc-400"
                      }`}
                    >
                      [{ev.kind}]
                    </span>
                    <span className="text-zinc-300 leading-tight break-words">{ev.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Panel Footer Statistics */}
        <div className="border-t border-[#2e3746] bg-[#12161f] p-3 text-[11px] font-mono text-zinc-400 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>Delivered: {doneTasks.length}</span>
          </div>
          <div>Obstacles: {snap.obstacles.length}</div>
          <div>Aisles Blocked: {snap.blockedCells.length > 0 ? "Yes" : "None"}</div>
        </div>
      </div>
    </div>
  );
}
