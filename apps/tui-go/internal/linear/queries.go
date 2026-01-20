package linear

// GraphQL queries for Linear API

const queryViewer = `
query Viewer {
  viewer {
    id
    name
    email
    teams {
      nodes {
        id
        name
        key
      }
    }
  }
}
`

const queryParentIssues = `
query ParentIssues($teamId: String!, $after: String) {
  team(id: $teamId) {
    issues(
      filter: {
        parent: { null: true }
      }
      first: 100
      after: $after
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        description
        priority
        createdAt
        updatedAt
        state {
          id
          name
          type
          color
        }
        parent {
          id
          identifier
          title
        }
        children {
          nodes {
            id
          }
        }
        labels {
          nodes {
            id
            name
            color
          }
        }
        assignee {
          id
          name
          displayName
          email
        }
        creator {
          id
          name
          displayName
          email
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`

const queryAssignedIssues = `
query AssignedIssues($teamId: String!, $after: String) {
  team(id: $teamId) {
    issues(
      filter: {
        assignee: { isMe: { eq: true } }
        parent: { null: true }
      }
      first: 100
      after: $after
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        description
        priority
        createdAt
        updatedAt
        state {
          id
          name
          type
          color
        }
        parent {
          id
          identifier
          title
        }
        children {
          nodes {
            id
          }
        }
        labels {
          nodes {
            id
            name
            color
          }
        }
        assignee {
          id
          name
          displayName
          email
        }
        creator {
          id
          name
          displayName
          email
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`

const querySubIssues = `
query SubIssues($issueId: String!, $after: String) {
  issue(id: $issueId) {
    children(first: 100, after: $after) {
      nodes {
        id
        identifier
        title
        description
        priority
        createdAt
        updatedAt
        state {
          id
          name
          type
          color
        }
        parent {
          id
          identifier
          title
        }
        children {
          nodes {
            id
          }
        }
        labels {
          nodes {
            id
            name
            color
          }
        }
        assignee {
          id
          name
          displayName
          email
        }
        creator {
          id
          name
          displayName
          email
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`

const queryIssue = `
query Issue($issueId: String!) {
  issue(id: $issueId) {
    id
    identifier
    title
    description
    priority
    createdAt
    updatedAt
    state {
      id
      name
      type
      color
    }
    parent {
      id
      identifier
      title
    }
    children {
      nodes {
        id
        identifier
        title
        state {
          id
          name
          type
        }
      }
    }
    labels {
      nodes {
        id
        name
        color
      }
    }
    assignee {
      id
      name
      displayName
      email
    }
    creator {
      id
      name
      displayName
      email
    }
  }
}
`

const queryTeamWorkflowStates = `
query TeamWorkflowStates($teamId: String!) {
  team(id: $teamId) {
    states {
      nodes {
        id
        name
        type
        color
      }
    }
  }
}
`
