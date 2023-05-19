# 📝 notemaker
Automating shared notetaking using GitHub integrated tools and common file formats.

## 📖 How to use
### Setup
Instantiate a private instance of this repository template inside of your GitHub account by using the "use this template" button in the top right.

### Storing and adding notes
Store your notes in a file called `notes.md` in this repository. Every new note section needs to be started with a h1 heading (single # prefix on a new line).
*notemaker* will split this file into new issues in this repository which are used as a store. If you want to modify notes before posting, you can modify the issue body.

### Mapping notes to accounts
For each of the top level topics that you want to group by (in this project's nomenclature "accounts"), create a new issue using the "Account Overview Template" issue template.
In the issue template, **replace** all placeholders marked in the form of `<REPLACE_ME>` with the appropriate content.

|   Field   |   Used for    |   Note    |
|   -----   |   --------    |   ----    |
|   ID      |   Label creation  |   Needs to be unique in this repository   |
|   Target Issue URL    |   URL of the issue where to post notes as comments    |   Needs to have [the PAT setup](#setting-up-other-repository-as-note-targets) to target other repos   |
|   Autopublish |   Select to automatically publish new notes without prior review  |   Put an "x" in the brackets to activate (`[x]`)  |
|   Keywords    |   Looking up the keywords in the note headings and associating them to the account overview issues |   This is a list, only add one keyword per line  |
|   Related Issues  |   Listing associated issues to review before publishing   |   Automatically populated, do not modify yourself |

**⚠️ Note**
*Do not add any further content to the account overview issue body, only replace the indicated fields. Otherwise the creation will fail (indicated by an error label).*

### Publishing notes from accounts
Once you create a new account overview template or add new notes, *notemaker* will automatically add the keyword-associated notes to the respective account-overview issue. To find all of your account-overview issues, you can filter your issues by the label `account-overview`.

On the account overview issue, you will find a list of issues related to this account with checkboxes in front of them. If you decide you are happy with a note and want to publish it to the given target issue, **just click the checkbox** and *notemaker* will do the rest.

After successfully publishing a note, you can find a comment on your account-overview issue indicating what was posted where.

That's all! Have fun with notemaker and feel free to open issues and PRs if you have any other good ideas or spot a bug!

### Setting up other repository as note targets
In order to write comments onto issues in other repositories, we first need to grant this action accesss.
The quickest way to do this is to [create a fine-grained personal access token (PAT)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token#creating-a-fine-grained-personal-access-token) that has the `Read and Write Issues` permission.

Make sure to scope this token to **all** potential target repos that you want to distribute notes to.

After you have obtained the token, store it inside of the `TARGET_TOKEN` GitHub Actions secret of your repository. Find out how to do this here: https://docs.github.com/en/actions/security-guides/encrypted-secrets#creating-encrypted-secrets-for-a-repository.
After this, you are all set to target the selected other repositories.

## 🔧 Debugging
### Recreating account overview issue
If you want to recreate an account overview issue, make sure to **delete** the old account overview issue, and **also delete the account-id label** that was created for this issue.
### Notes are not distributing (404 error shown)
This can be indicative for a situation where you have not supplied a properly authenticated personal access token (PAT) for the accounts target issue.
Please make sure to create a PAT that is authorized to `Read and Write Issues` on all potential repositories that you want to post issues to and follow the [Setting up other repositorie as note targets](#setting-up-other-repositorie-as-note-targets) tutorial.
