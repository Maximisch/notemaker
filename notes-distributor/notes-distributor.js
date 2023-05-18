// Create a javascript github action that traverses all issues in the current repo that are labelled "account-overview"
// Extract the list of keywords from each of those issues (using the keywordsRegex) and create a map of issues to keywords
// Traverse all issues in the current repo that are not labelled "account-overview" and if one of they keywords from the map is found in the issue title, map the issue to the corresponding account-overview issue

const core = require('@actions/core');
const github = require('@actions/github');
const token = core.getInput('token');
const octokit = github.getOctokit(token);

// TODO Centralize these constants
const keywordsRegex = /## Keywords:((\r\n)((- .+(\r\n)?)*))/g;
const relatedIssuesRegex = /## Related Issues:((\r\n)?((- \[[\sx]\].+(\r\n)?)*))/g;
const accountOverviewLabel = "account-overview";

let allAccountOverviewIssues = [];
let accountIssueIDsToKeywords = {};
let accountIssueIDsToNoteIssueIDs = {};

async function run() {
    // Retrieve all issues in the current repo that are labelled "account-overview"
    allAccountOverviewIssues = await octokit.rest.issues.listForRepo({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        labels: accountOverviewLabel
    }).catch((error) => {
        core.setFailed(error.message);
    });
    
    // Extract the list of keywords from each of those issues (using the keywordsRegex) and create a map of issues to keywords
    for (let i = 0; i < allAccountOverviewIssues.data.length; i++) {
        let issue = allAccountOverviewIssues.data[i];
        console.log("Extracting keywords from issue", issue.number);
        let keywords = extractKeywords(issue.body);
        accountIssueIDsToKeywords[issue.number] = keywords;
    }

    // Traverse all issues in the current repo that are not labelled "account-overview" and if one of they keywords from the map is found in the issue title, map the issue to the corresponding account-overview issue
    // use pagination
    const allIssues = await octokit.paginate("GET /repos/{owner}/{repo}/issues", {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        per_page: 100,
    }).catch((error) => {
        core.setFailed(error.message);
    });
    console.log("PrevSize",allIssues.length);
    allIssues
        .filter((issue) => issue.number !== github.context.issue.number)
        .filter((issue) => issue.labels.filter((label) => label.name === accountOverviewLabel).length === 0)
        .forEach((issue) => {
            let issueTitle = issue.title;
            for (let accountIssueID in accountIssueIDsToKeywords) {
                let keywords = accountIssueIDsToKeywords[accountIssueID];
                if (keywords.some((keyword) => issueTitle.toLowerCase().includes(keyword.toLowerCase()))) {
                    if (accountIssueIDsToNoteIssueIDs[accountIssueID]) {
                        accountIssueIDsToNoteIssueIDs[accountIssueID].push(issue.number);
                    } else {
                        accountIssueIDsToNoteIssueIDs[accountIssueID] = [issue.number];
                    }
                }
            }
        });
    console.log("PostSize", allIssues.length);

    // DEBUG
    console.log(JSON.stringify(accountIssueIDsToNoteIssueIDs));


    // Traverse accountIssueIDsToNoteIssueIDs keys (=account overview issue numbers) and for each one, retrieve the issue body and extract the related issues task list
    // Once we have extracted the task list, update it to include the mapped issues, while maintaining the existing state (checked/unchecked) of the existing tasks
    for (let accountIssueID in accountIssueIDsToNoteIssueIDs) {
        // Store objects of format {issueNumber: issueNumber, checked: true/false} in currentRelatedIssuesTaskList
        let currentRelatedIssuesTaskList = [];
        let accountIssue = allIssues.find((issue) => issue.number == accountIssueID);
        if (!accountIssue) {
            console.error("Could not find account issue", accountIssueID, "in the list of all issues, skipping", JSON.stringify(allIssues));
            core.setFailed("Could not find account issue " + accountIssueID + " in the list of all issues, skipping");
            return;
        }
        let accountIssueBody = accountIssue.body;
        let match = new RegExp(relatedIssuesRegex).exec(accountIssueBody);
        if (match) {
            currentRelatedIssuesTaskLIst = extractRelatedIssues(accountIssueBody);
        } else {
            console.log("Did not find any existing related issues for account issue", accountIssueID);
        }
        // generate new task list and replace the old one
        let newRelatedIssuesTaskList = currentRelatedIssuesTaskList;
        accountIssueIDsToNoteIssueIDs[accountIssueID].forEach((noteIssueID) => {
            if (newRelatedIssuesTaskList.find((task) => task.issueNumber === noteIssueID)) {
                console.debug("Issue", noteIssueID, "already exists in the related issues task list for account issue", accountIssueID, ", skipping");
            } else {
                console.debug("Adding issue", noteIssueID, "to the related issues task list for account issue", accountIssueID);
                newRelatedIssuesTaskList.push({
                    issueNumber: noteIssueID,
                    checked: false,
                });
            }
        });
        // Generate task list string
        let newRelatedIssuesTaskListString = "## Related Issues:\r\n";
        newRelatedIssuesTaskList.forEach((task) => {
            newRelatedIssuesTaskListString += `- [${task.checked ? "x" : " "}] #${task.issueNumber}\r\n`;
        });
        // Replace the old task list with the new one
        let newAccountIssueBody = accountIssueBody.replace(new RegExp(relatedIssuesRegex), newRelatedIssuesTaskListString);
        // Update the issue
        await octokit.rest.issues.update({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: accountIssueID,
            body: newAccountIssueBody
        }).catch((error) => {
            core.setFailed(error.message);
        });
    }



}

run();

function extractKeywords(issueBody) {
    let keywords = [];
    let match = new RegExp(keywordsRegex).exec(issueBody);
    if (match) {
        let keywordsString = match[1];
        keywords = keywordsString.split(/\r\n/g);
        console.debug("Found keywords, extracting", JSON.stringify(keywords));
        let individualKeywordRegex = /- (.+)/g;

        // Extract the keyword from each line
        keywords = [];
        while ((match = individualKeywordRegex.exec(keywordsString)) !== null) {
            keywords.push(match[1]);
        }
        console.log("Extracted keywords:", JSON.stringify(keywords));
    }
    return keywords;
}

function extractRelatedIssues(issueBody) {
    let relatedIssues = [];
    let match = new RegExp(relatedIssuesRegex).exec(issueBody);
    if (match) {
        let relatedIssuesString = match[1];
        relatedIssues = relatedIssuesString.split(/\r\n/g);
        console.debug("Found relatedIssues, extracting", JSON.stringify(relatedIssues));
        let individualRelatedIssueRegex = /- \[([\sx])\] #(\d+)/g;

        // Extract the relatedIssue from each line
        relatedIssues = [];
        while ((match = individualRelatedIssueRegex.exec(relatedIssuesString)) !== null) {
            relatedIssues.push({
                issueNumber: match[2],
                checked: match[1] === "x",
            });
        }
        console.log("Extracted relatedIssues:", JSON.stringify(relatedIssues));
    }
    return relatedIssues;
}
