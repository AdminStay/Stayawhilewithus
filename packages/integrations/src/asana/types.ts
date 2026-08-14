// Asana API credentials — a personal access token (Bearer auth).
export interface AsanaCredentials {
  accessToken: string;
}

export interface AsanaUser {
  gid: string;
  name?: string;
  email?: string;
}

export interface AsanaWorkspace {
  gid: string;
  name: string;
}

export interface AsanaListResponse<T> {
  data: T[];
}
