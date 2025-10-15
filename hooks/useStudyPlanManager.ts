// In your Vercel app - update the schedule generation function

async function generateSchedule() {
    try {
        showLoading();
        
        // Get form data
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const includeOptional = document.getElementById('includeOptional')?.checked ?? true;
        
        // Call your local OR-Tools service
        const response = await fetch('http://localhost:8001/generate-schedule', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                startDate: startDate,
                endDate: endDate,
                includeOptional: includeOptional,
                dailyStudyMinutes: 840 // 14 hours
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const scheduleData = await response.json();
        displaySchedule(scheduleData);
        hideLoading();
        
    } catch (error) {
        console.error('Error generating schedule:', error);
        hideLoading();
        alert('Error generating schedule: ' + error.message);
    }
}

function displaySchedule(data) {
    const { schedule, summary } = data;
    
    // Clear previous results
    const resultsContainer = document.getElementById('results');
    resultsContainer.innerHTML = '';
    
    // Display summary
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'summary';
    summaryDiv.innerHTML = `
        <h2>Study Schedule Summary</h2>
        <div class="summary-stats">
            <div class="stat">
                <span class="stat-number">${summary.total_days}</span>
                <span class="stat-label">Total Days</span>
            </div>
            <div class="stat">
                <span class="stat-number">${summary.total_resources}</span>
                <span class="stat-label">Total Resources</span>
            </div>
            <div class="stat">
                <span class="stat-number">${summary.total_study_hours}h</span>
                <span class="stat-label">Total Study Hours</span>
            </div>
            <div class="stat">
                <span class="stat-number">${summary.average_daily_hours}h</span>
                <span class="stat-label">Avg Daily Hours</span>
            </div>
        </div>
    `;
    resultsContainer.appendChild(summaryDiv);
    
    // Display daily schedule
    const scheduleDiv = document.createElement('div');
    scheduleDiv.className = 'daily-schedule';
    
    schedule.forEach(day => {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'day-card';
        
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.innerHTML = `
            <h3>${formatDate(day.date)}</h3>
            <div class="day-stats">
                <span class="total-time">${day.total_hours}h</span>
                <span class="resource-count">${day.resources.length} resources</span>
            </div>
        `;
        dayDiv.appendChild(dayHeader);
        
        // Group resources by category
        const resourcesByCategory = {};
        day.resources.forEach(resource => {
            const category = resource.category || 'OTHER';
            if (!resourcesByCategory[category]) {
                resourcesByCategory[category] = [];
            }
            resourcesByCategory[category].push(resource);
        });
        
        // Display resources by priority category
        const categoryOrder = [
            'TITAN_VIDEO_GROUP', 'HUDA_PHYSICS_GROUP', 'TITAN_NUCS_GROUP',
            'NIS_RISC_GROUP', 'BOARD_VITALS_GROUP', 'TITAN_PHYSICS_GROUP',
            'RAD_DISCORD_GROUP', 'CORE_RADIOLOGY_GROUP'
        ];
        
        categoryOrder.forEach(category => {
            if (resourcesByCategory[category]) {
                const categoryDiv = document.createElement('div');
                categoryDiv.className = `category-section ${category.toLowerCase()}`;
                categoryDiv.innerHTML = `<h4>${getCategoryDisplayName(category)}</h4>`;
                
                const resourcesList = document.createElement('ul');
                resourcesList.className = 'resources-list';
                
                resourcesByCategory[category].forEach(resource => {
                    const resourceItem = document.createElement('li');
                    resourceItem.className = 'resource-item';
                    resourceItem.innerHTML = `
                        <div class="resource-title">${resource.title}</div>
                        <div class="resource-meta">
                            <span class="duration">${resource.duration_minutes} min</span>
                            <span class="domain">${resource.domain}</span>
                            <span class="type">${resource.type}</span>
                        </div>
                    `;
                    resourcesList.appendChild(resourceItem);
                });
                
                categoryDiv.appendChild(resourcesList);
                dayDiv.appendChild(categoryDiv);
            }
        });
        
        // Add Board Vitals suggestions
        if (day.board_vitals_suggestions) {
            const bvDiv = document.createElement('div');
            bvDiv.className = 'board-vitals-suggestions';
            bvDiv.innerHTML = `
                <h5>Board Vitals Mixed Review</h5>
                <p><strong>${day.board_vitals_suggestions.suggested_questions} questions</strong></p>
                <p>Topics: ${day.board_vitals_suggestions.covered_topics.join(', ')}</p>
                <p class="note">${day.board_vitals_suggestions.note}</p>
            `;
            dayDiv.appendChild(bvDiv);
        }
        
        scheduleDiv.appendChild(dayDiv);
    });
    
    resultsContainer.appendChild(scheduleDiv);
}

function getCategoryDisplayName(category) {
    const names = {
        'TITAN_VIDEO_GROUP': '1. Titan Radiology Videos & Paired Resources',
        'HUDA_PHYSICS_GROUP': '2. Huda Physics & Paired Resources',
        'TITAN_NUCS_GROUP': '3. Titan Nuclear Medicine & Paired Resources',
        'NIS_RISC_GROUP': '4. NIS/RISC Documents & Questions',
        'BOARD_VITALS_GROUP': '5. Board Vitals Mixed Review',
        'TITAN_PHYSICS_GROUP': '6. Titan Physics & Paired Resources',
        'RAD_DISCORD_GROUP': '7. Radiology Discord Lectures (Optional)',
        'CORE_RADIOLOGY_GROUP': '8. Core Radiology Text (Optional)'
    };
    return names[category] || category;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
}

function showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('generateButton').disabled = true;
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('generateButton').disabled = false;
}
