const core = require('@actions/core');
const github = require('@actions/github');

//TODO Add Master Account Tracking URL to the master issue template
const masterIssueTemplateRegex = /(<!--(\r\n)Note: Please replace the indicated strings \(format <REPLACE-ME>\) below and leave the rest unmodified(\r\n)-->(\r\n)*)?# Account Overview(\r\n)## Account ID: ([a-zA-Z0-9-_]+)(\r\n)## Target issue URL: ([\/\.:a-zA-Z0-9-]+)(\r\n)## Autopublish: \[([\sx])\](\r\n)## Keywords:((\r\n)((- .+(\r\n)?)*))(\r\n)## Related Issues:((\r\n)?((- \[[\sx]\].+(\r\n)?)*))/g;
const accountIdRegex = /## Account ID: ([a-zA-Z-_]+)(\r\n)/g;
const targetIssueUrlRegex = /## Target issue URL: ([\/\.:a-zA-Z0-9-]+)(\r\n)/g;
const autopublishRegex = /## Autopublish: \[([\sx])\](\r\n)/g;
const keywordsRegex = /## Keywords:((\r\n)((- .+(\r\n)?)*))/g;
// TODO Enhance tasklist syntax to cover if annotations for ```tasklist {} ```are included
const relatedIssuesRegex = /## Related Issues:((\r\n)?((- \[[\sx]\].+(\r\n)?)*))/g;


// Create issue labels if they don't exist (pattern is: <account-ID>)
// Verify master issue coherence (Has to contain an account-ID, a checkbox for autopublishing, a list of keywords and a tasklist of related issues - which can also be empty)
// process changes to master issues
// run on all issue body modifications
// at runtime first check if it's labeled account-overview (if not terminate)
// trigger note-publisher if tasklist item was checked off (using matrix strategy output)
async function run() {
    try {
        const token = core.getInput('token');
        const octokit = github.getOctokit(token);
        let targetOctokit;
        // If we have an input for the target token, use it, otherwise use the default octokit
        if (core.getInput('targetToken')) {
            targetOctokit = github.getOctokit(core.getInput('targetToken'));
        } else {
            targetOctokit = octokit;
        }

        // Check if a label with that name already exists, and if yes, terminate
        const labels = await octokit.rest.issues.listLabelsForRepo({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
        });

        // If the context was issue creation, create a new label for the issue with the accountId and label it with the label "account-overview" (to create if it does not exist)
        if (github.context.eventName === 'issues') {

            // If the issue does not contain the label "account-overview", terminate
            if (!github.context.payload.issue.labels.find((label) => label.name === 'account-overview')) {
                console.error("Issue does not contain the label 'account-overview', assuming it's a note and terminating. If you believe this is a mistake, please verify the issue template.");
                console.setFailed("Issue does not contain the label 'account-overview', assuming it's a note and terminating. If you believe this is a mistake, please verify the issue template.");
                return;
            }

            // Verify issue structure
            if (! await verifyStructure(github.context.payload.issue.body, octokit)) {
                console.error("Issue structure is not valid");
                core.setFailed("Issue structure is not valid");
                await applyErrorLabel(github.context.payload.issue.number, octokit);
                return;
            } else {
                console.log("Issue structure is valid");
                // Remove error label if it is applied
                let issueLabels = github.context.payload.issue.labels.map((label) => label.name);
                if (issueLabels.includes('invalid-issue-structure')) {
                    await octokit.rest.issues.removeLabel({
                        owner: github.context.repo.owner,
                        repo: github.context.repo.repo,
                        issue_number: github.context.payload.issue.number,
                        name: 'invalid-issue-structure'
                    });
                }
            }
            
            // If the issue was edited: Determine differences and act accordingly
            if (github.context.payload.action === 'edited') {
                // Check if the tasklist was updated by comparing the old and new body
                // if yes, check if the tasklist item was checked off
                // if yes, trigger note-publisher
                // if no, terminate
                
                let sourceIssueUrl = github.context.payload.issue.html_url;
                let oldBody = github.context.payload.changes.body.from;
                let newBody = github.context.payload.issue.body;

                // a tasklist item has two fields, checked (boolean) and reference (string)
                let oldTasklistItems = getTasklistEntries(oldBody);
                let newTasklistItems = getTasklistEntries(newBody);

                console.log("Old tasklist items: ", oldTasklistItems);
                console.log("New tasklist items: ", newTasklistItems);

                // check if the tasklist was updated
                let diffItems = newTasklistItems.filter(x => !oldTasklistItems.some(y => y.reference === x.reference && y.checked === x.checked));
                if (diffItems.length === 0) {
                    console.log("Tasklist was not updated");
                } else {
                    console.log("Tasklist was potentially updated");
                    
                    autopublish = new RegExp(autopublishRegex).exec(github.context.payload.issue.body)[1] === "x";
                    // Check if autopublish is checked, and if yes, trigger note-publisher for every newly added tasklist item
                    // Else, check if the tasklist item was checked off
                    let checkedItems = diffItems.filter(x => autopublish || x.checked === true);
                    if (checkedItems.length === 0) {
                        console.log("Tasklist item was not checked off");
                    } else {
                        console.log("Tasklist item was checked off");
                        let targetIssueUrl = new RegExp(targetIssueUrlRegex).exec(github.context.payload.issue.body)[1];
                        console.log("Triggering note-publisher", checkedItems, targetIssueUrl);
                        await checkedItems
                            .forEach(async (item) => {
                                let issueNumber = item.reference.substring(1);
                                let createdComment = await publishNote(issueNumber, sourceIssueUrl, targetIssueUrl, octokit, targetOctokit);
                                // Add reference to created comment to the issue
                                await addCreationComment(issueNumber, createdComment, octokit);
                                item.checked = true;
                            });
                        // Update tasklist correspondingly (check off items published)
                        let newBodyUpdated = updateTasklist(newTasklistItems, newBody);
                        await octokit.rest.issues.update({
                            owner: github.context.repo.owner,
                            repo: github.context.repo.repo,
                            issue_number: github.context.payload.issue.number,
                            body: newBodyUpdated
                        });
                    }
                }
            } else if (github.context.payload.action === 'opened') {
                // Issue was created: Setup labeling for this account

                // Create a new label for the account if it doesn't exist yet
                const accountId = new RegExp(accountIdRegex).exec(github.context.payload.issue.body)[1];
                const labelName = `${accountId}`;
                if (labels.data.find((label) => label.name === labelName)) {
                    console.error(`Label with name "${labelName}" already exists`);
                    core.setFailed(`Label with name "${labelName}" already exists`);
                    await applyErrorLabel(github.context.payload.issue.number, octokit);
                    return;
                } else {
                    console.log("Creating label", labelName);
                    // create the label
                    await octokit.rest.issues.createLabel({
                        owner: github.context.repo.owner,
                        repo: github.context.repo.repo,
                        name: labelName,
                        description: 'This label is used to identify issues that are related to the account-overview of a specific account',
                    });
                    console.log("Label successfully created", labelName);

                }
                // Set output to trigger issue distribution action in actions workflow
                console.log("Setting output to trigger issue distribution action")
                core.setOutput("trigger-distribution", "true");

                // Apply account overview and account-id labels to the issue
                console.log("Applying labels", ['account-overview', labelName]);
                await octokit.rest.issues.addLabels({
                    owner: github.context.repo.owner,
                    repo: github.context.repo.repo,
                    issue_number: github.context.payload.issue.number,
                    labels: ['account-overview', labelName],
                });
                console.log("Labels successfully applied", ['account-overview', labelName]);
            } else {
                console.error("Action not supported", github.context.payload.action);
                core.setFailed("Action not supported" +  github.context.payload.action);
                await applyErrorLabel(github.context.payload.issue.number, octokit);
                return;
            }            
        } else {
            console.error("Only issues trigger is allowed");
            core.setFailed("Only issues trigger is allowed");
            return;
        }
    } catch (error) {
        console.error(error);
        core.setFailed(error.message);
    }
}

function updateTasklist(newTasklistItems, newBody) {
    let newBodyUpdated = newBody;
    newTasklistItems.forEach((item) => {
        let tasklistRegex = /- \[\s\] #${item.reference}/g;
        newBodyUpdated = newBodyUpdated.replace(tasklistRegex, `- [x] ${item.reference}`);
    });
    return newBodyUpdated;
}

function getTasklistEntries(issueBody) {
    let tasklistItems = [];
    let tasklistRegex = /- \[([\sx])\] (.+)/g;
    let tasklistMatch;
    while ((tasklistMatch = tasklistRegex.exec(issueBody)) !== null) {
        tasklistItems.push({
            checked: tasklistMatch[1] === 'x',
            reference: tasklistMatch[2]
        });
    }
    return tasklistItems;
}

async function verifyStructure(issueBody, octokit) {
    // Check if a label with that name already exists, and if yes, terminate
    const labels = await octokit.rest.issues.listLabelsForRepo({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
    });

    // Check if the issue body matches the masterIssueTemplateRegex
    let masterIssueTemplateMatch = masterIssueTemplateRegex.test(github.context.payload.issue.body);
    if (! masterIssueTemplateMatch) {
        console.error("Issue body does not match the master issue template");
        core.setFailed("Issue body does not match the master issue template");
        // check which sub-regexes match
        let matchSubRegexes = {
            masterIssueTemplateMatch : masterIssueTemplateMatch,
            accountIdRegex : new RegExp(accountIdRegex).test(github.context.payload.issue.body),
            targetIssueUrlRegex : new RegExp(targetIssueUrlRegex).test(github.context.payload.issue.body),
            autopublishRegex : new RegExp(autopublishRegex).test(github.context.payload.issue.body),
            keywordsRegex : new RegExp(keywordsRegex).test(github.context.payload.issue.body),
            relatedIssuesRegex : new RegExp(relatedIssuesRegex).test(github.context.payload.issue.body),
        };
        console.log(JSON.stringify(matchSubRegexes));
        return false;
    } else {
        console.log("Issue body matches the master issue template");
        // check if the account ID is valid (must be a string of at least 1 character and alphanumeric characters, dashes and underscores are allowed)
        let accountId = new RegExp(accountIdRegex).exec(github.context.payload.issue.body)[1];
        let accountIdValid = accountId.match(/^[a-zA-Z-_]+$/);
        if (!accountIdValid) {
            console.error("Account ID is not valid, must only contain alphanumeric characters, dashes and underscores");
            core.setFailed("Account ID is not valid, must only contain alphanumeric characters, dashes and underscores");
            return false;
        }

        // check if the target issue URL is valid
        let targetIssueUrl = new RegExp(targetIssueUrlRegex).exec(github.context.payload.issue.body)[1];
        let targetIssueUrlValid = targetIssueUrl.match(/https:\/\/github.com\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+\/issues\/[0-9]+/);
        if (!targetIssueUrlValid) {
            console.error("Target issue URL is not valid, must be a valid GitHub issue URL");
            core.setFailed("Target issue URL is not valid, must be a valid GitHub issue URL");
            return false;
        }
        
        // check if the keywords are valid (at least one keyword is required)
        let keywords = new RegExp(keywordsRegex).exec(github.context.payload.issue.body)[1];
        let keywordsValid = keywords.match(/^- .+/gm);
        if (!keywordsValid) {
            console.error("Keywords are not valid, at least one keyword is required");
            core.setFailed("Keywords are not valid, at least one keyword is required");
            return false;
        }

        // check if the related issues are valid
        // (Can either be empty, or a tasklist that contains an arbitrary count of only issue references in the form of #<issue-number>)
        let relatedIssues = new RegExp(relatedIssuesRegex).exec(github.context.payload.issue.body)[1];
        let relatedIssuesValid = relatedIssues.trim() == "" || relatedIssues.match(/^- \[[\sx]\] #\d+/gm);
        if (!relatedIssuesValid) {
            console.error("Related issues are not valid, can either be empty or a tasklist that contains an arbitrary count of only issue references in the form of #<issue-number>");
            core.setFailed("Related issues are not valid, can either be empty or a tasklist that contains an arbitrary count of only issue references in the form of #<issue-number>");
            return false;
        }
    }
    return true;
}

async function applyErrorLabel(issueNumber, octokit) {
    //Create error label if it doesn't exist yet
    let labels = await octokit.rest.issues.listLabelsForRepo({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
    });
    if (!labels.data.find((label) => label.name === 'invalid-issue-structure')) {
        console.log("Creating invalid-issue-structure label..");
        await octokit.rest.issues.createLabel({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            name: 'invalid-issue-structure',
            color: 'dc2626',
            description: 'This label is used to identify note-keeping system rule-incompliant issues.',
        });
    }
    // Apply error label to the issue
    await octokit.rest.issues.addLabels({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issueNumber,
        labels: ['invalid-issue-structure'],
    });
}

async function publishNote(issueNumber, sourceIssueUrl, targetIssueUrl, octokitSource, octokitTarget) {
    let noteIssue = await octokitSource.rest.issues.get({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: issueNumber,
    });
    // Retrieve the note issue title
    let issueTitle = noteIssue.data.title;
    let issueBody = noteIssue.data.body;
    // Assemble the comment text
    let commentText = `# ${issueTitle}\r\n\r\n${issueBody}\r\n\r\n_This note was published by the [note-keeping system](https://github.com/maximisch/notemaker)._`;
    // Create a comment on the target issue
    let targetIssueOwner = new RegExp(/https:\/\/github.com\/([a-zA-Z0-9-_]+)\/[a-zA-Z0-9-_]+\/issues\/[0-9]+/).exec(targetIssueUrl)[1];
    let targetIssueRepo = new RegExp(/https:\/\/github.com\/[a-zA-Z0-9-_]+\/([a-zA-Z0-9-_]+)\/issues\/[0-9]+/).exec(targetIssueUrl)[1];
    let targetIssueNumber = new RegExp(/https:\/\/github.com\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+\/issues\/([0-9]+)/).exec(targetIssueUrl)[1];
    console.log("Extracted target issue information for comment posting", targetIssueOwner, targetIssueRepo, targetIssueNumber);
    return await octokitTarget.rest.issues.createComment({
        owner: targetIssueOwner,
        repo: targetIssueRepo,
        issue_number: targetIssueNumber,
        body: commentText,
    });
}

// Adds a comment to the account tracking issue that a note was published to the target issue
async function addCreationComment(issueNumber, createdComment, octokit) {
    // Assemble the comment text
    let commentText = `The issue #${issueNumber} was [published successfully](${createdComment.data.html_url})!`;
    // Create a comment on the account tracking issue
    await octokit.rest.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: github.context.payload.issue.number,
        body: commentText,
    });
}

// Call the run function
run();