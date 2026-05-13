export type TeamRole = "owner" | "admin" | "member";
export type InvitationStatus = "pending" | "accepted" | "declined" | "expired";

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  user_profile?: {
    display_name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  email: string;
  role: TeamRole;
  status: InvitationStatus;
  invited_by: string;
  created_at: string;
  expires_at: string;
}

export interface TeamWithMembers extends Team {
  members: TeamMember[];
  member_count: number;
}

export interface TeamMemberStat {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  sessions: number;
  total_cost_usd: number;
  top_tool: string | null;
  last_active: string | null; // YYYY-MM-DD
}

export interface TeamTrendPoint {
  date: string; // YYYY-MM-DD
  sessions: number;
}

export interface TeamShareSnapshot {
  team: { name: string; slug: string };
  stats: {
    total_sessions: number;
    total_cost_usd: number;
    active_members: number;
    total_members: number;
    avg_session_duration_min: number;
  };
  members: TeamMemberStat[];
  trend: TeamTrendPoint[];
  shared_by: string;
  captured_at: string; // ISO timestamp
}
