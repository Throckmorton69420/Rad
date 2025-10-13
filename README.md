# Radiology Core Exam Study Planner

This project is an interactive, day-by-day study planner for radiology residents. It features a React frontend, a TypeScript API layer hosted on Vercel, and a powerful Python CP-SAT optimization backend hosted on Google Cloud Run.

## Project Architecture

This is a dual-deployment project with two distinct parts:

1.  **Vercel Project (Frontend & API Layer):** This is the user-facing application built with React and Vite. It also includes the TypeScript serverless functions in the `/api` directory that act as a secure bridge to the backend. This part is deployed automatically from your GitHub repository to Vercel.

2.  **Google Cloud Run Project (Python Backend):** This is a powerful Python solver that performs the heavy lifting of schedule generation using Google's OR-Tools (CP-SAT). This part is deployed **manually** from your local machine to Google Cloud Run.

It is **critical** to understand that these are two separate deployments.

---

## Part 1: Deploying the Vercel Frontend & API Layer

### Step 1: Set up Supabase

1.  Go to [Supabase](https://supabase.com/) and create a new project.
2.  Once the project is ready, go to the "SQL Editor" section.
3.  Copy the entire content of the `schema.sql.json` file from this project and paste it into a new query window.
4.  Click "RUN" to create the necessary tables (`resources`, `runs`, `schedule_slots`, `user_data`).
5.  Go to **Project Settings** > **API**. Find and copy your **Project URL** and your `anon` **public** key. You will need these for Vercel.
6.  Also on the API page, find the `service_role` **secret** key. You will need this for both Vercel and Cloud Run.

### Step 2: Set up the Vercel Project

1.  Fork this GitHub repository to your own GitHub account.
2.  Go to [Vercel](https://vercel.com/) and create a new project.
3.  Import the GitHub repository you just forked.
4.  Before deploying, go to the project's **Settings** > **Environment Variables**. Add the following variables:

| Variable Name                    | Value                                                              | Description                                                      |
| -------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `GCP_SERVICE_ACCOUNT_KEY_BASE64` | The Base64 encoded string of your GCP service account JSON key.    | **CRITICAL:** Used by the `/api/solve` function to authenticate. |
| `SOLVER_URL`                     | The URL of your deployed Google Cloud Run service (from Part 2).   | **CRITICAL:** The target for the API calls.                      |
| `SUPABASE_SERVICE_ROLE_KEY`      | Your Supabase `service_role` **secret** key.                       | For server-side API functions to access Supabase.                |
| `VITE_SUPABASE_URL`              | Your Supabase Project URL.                                         | `VITE_` prefix is required. For client-side access.              |
| `VITE_SUPABASE_ANON_KEY`         | Your Supabase `anon` **public** key.                               | `VITE_` prefix is required. For client-side access.              |

5.  Deploy the project. Any future pushes to your GitHub repo will automatically trigger new deployments on Vercel.

---

## Part 2: Deploying the Google Cloud Run Backend

This is a **manual** process you run from the terminal on your computer.

### Step 1: Prepare Your Local Environment

1.  **Install Google Cloud CLI:** Follow the official instructions to [install `gcloud`](https://cloud.google.com/sdk/docs/install).
2.  **Authenticate `gcloud`:** Open your terminal and run the following command. It will open a browser window for you to log in to your Google account.
    ```bash
    gcloud auth login
    ```
3.  **Set Your Project:** Tell `gcloud` which project you're working on. Replace `scheduler-474709` with your actual GCP Project ID.
    ```bash
    gcloud config set project scheduler-474709
    ```
4.  **Prepare Files:** On your computer (e.g., on your Desktop), create a folder. Inside it, place the three backend files, named **exactly** as follows:
    *   `main.py`
    *   `Dockerfile` (no extension)
    *   `requirements.txt`

### Step 2: Run the Deployment Command

1.  Open your terminal and navigate into the folder you created in the previous step.
    ```bash
    # Example if your folder is on the Desktop
    cd ~/Desktop/your-folder-name
    ```
2.  Run the following deployment command. **You must replace the placeholder for your Supabase secret key.**

    ```bash
    gcloud run deploy radiology-solver \
      --source . \
      --platform managed \
      --region us-central1 \
      --no-allow-unauthenticated \
      --set-env-vars="SUPABASE_URL=https://wwjibyasyzrlycrvogzy.supabase.co" \
      --set-env-vars="SUPABASE_KEY=PASTE_YOUR_SUPABASE_SERVICE_ROLE_KEY_DIRECTLY_HERE" \
      --timeout=900 \
      --cpu=1 \
      --memory=2Gi \
      --min-instances=0
    ```
    
    **IMPORTANT:** When replacing `PASTE_YOUR_SUPABASE_SERVICE_ROLE_KEY_DIRECTLY_HERE`, paste only the key itself. Do **not** include `SUPABASE_KEY=` inside the quotes.
    
    -   **Correct:** `--set-env-vars="SUPABASE_KEY=eyJh..."`
    -   **Incorrect:** `--set-env-vars="SUPABASE_KEY=SUPABASE_KEY=eyJh..."`

3.  The deployment process will take several minutes. When it's finished, it will output the **Service URL**. This is the URL you need to copy and paste into the `SOLVER_URL` environment variable in your Vercel project settings.

### Step 3: Grant Invoke Permissions (CRITICAL FINAL STEP)

The new service is private. You must grant your Vercel project permission to call it.

1.  Go to your Google Cloud project and create a service account (e.g., `Vercel-task-creator`). Grant it the `Service Account Token Creator` role.
2.  Generate a JSON key for this service account and Base64 encode it to use for the `GCP_SERVICE_ACCOUNT_KEY_BASE64` variable in Vercel.
3.  Open the **Google Cloud Shell** in your browser.
4.  Run the following command to grant the service account permission to invoke your Cloud Run service. Replace the email with your service account's email.

    ```bash
    gcloud run services add-iam-policy-binding radiology-solver \
      --member="serviceAccount:vercel-task-creator@scheduler-474709.iam.gserviceaccount.com" \
      --role="roles/run.invoker" \
      --region="us-central1"
    ```

Your backend is now deployed and secured. Your Vercel frontend can now successfully call it.