const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const glob = require('@actions/glob');

async function run() {
    try {
        const token = core.getInput('token');
        const octokit = github.getOctokit(token);
        
        const noteFileName = core.getInput('noteFileName');
        const globber = await glob.create(`**/${noteFileName}`);
        const files = await globber.glob();

        if (files.length === 0) {
            console.log('No notes.md file found');
            return;
        } else {
            console.log("Found notes.md file, starting to process...");
        }

        const file = files[0];
        const contents = fs.readFileSync(file, 'utf8');

        const regex = /^# (.+)$/gm;
        let match;
        const { owner, repo } = github.context.repo;
        console.log("Retrieving issues...");
        const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
            owner,
            repo,
            per_page: 100,
          });
        
        console.log("Retrieved issues, found", issues.length);
        while ((match = regex.exec(contents)) !== null) {
            const title = match[1];
            // We create a new RegExp instance to search for the next match starting from the end of the previous match without modifying the lastIndex of the original regex
            const nextMatch = new RegExp(regex).exec(contents.slice(match.index + match[0].length));
            const startOfBody = match.index + match[0].length;
            const endOfBody = nextMatch ? match.index + match[0].length + nextMatch.index : undefined;
            const body = contents.slice(startOfBody, endOfBody);

            // Check if there is already an issue with the same title
            const existingIssue = issues.find((issue) => issue.title == title);
            if (existingIssue) {
                console.log(`Issue with title "${title}" already exists`);
                continue;
            } else {
                console.log(`Creating issue with title "${title}"`);
            
                // Add the newly created issue to the list of issues
                issues.push({
                    title,
                    body,
                });

                // Create a new issue
                try {
                    await octokit.rest.issues.create({
                        owner,
                        repo,
                        title,
                        body,
                    });
                } catch (error) {
                    console.log("Failed to create issue, skipping...", error);
                }
            }
        }
    } catch (error) {
        core.setFailed(error.message);
        console.log(error);
    }
}

// Call the run function
run();