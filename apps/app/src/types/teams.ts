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
