export interface GitFile {
  path: string;
  status: string; // e.g., " M", "A ", "??", "UU"
  x: string;
  y: string;
  staged: boolean;
  modified: boolean;
  displayStatus: string; // e.g., "Modified", "Staged", "Untracked", "Conflict"
}

export interface CommitNode {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
}

export interface Branch {
  name: string;
  isCurrent: boolean;
}

export interface StashItem {
  line: string;
}
