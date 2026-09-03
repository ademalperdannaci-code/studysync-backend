export interface JWTPayload {
  userId: string;
  email: string;
  username: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PomodoroState {
  isRunning: boolean;
  currentCycle: number;
  phase: "work" | "break" | "longBreak";
  timeLeft: number;
  startedAt: number;
}
