async function extractTextFromPDF(file) {
    const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(" ") + "\n";
    }

    return text;
}


// PDF 문서 구조 분석하여 학생 정보 추출
function parseStudents(text) {
    const lines = text.split("\n").map(t => t.trim()).filter(Boolean);

    const students = [];
    let current = {};

    lines.forEach(line => {
        if (line.match(/^\d{1,2}\/\d+/)) {
            if (Object.keys(current).length > 0) students.push(current);
            current = { 번호: line };
        }

        if (line.includes("읽기") || line.includes("쓰기") || line.includes("듣기") || line.includes("말하기"))
            current.영역 = line;

        if (line.includes("[")) current.성취기준 = line;

        if (line.includes("상") || line.includes("중") || line.includes("하"))
            current.단계 = line;

        if (line.length > 30 && current.단계) // 긴 문장은 평가결과로 간주
            current.평가결과 = line;

        if (line.length >= 2 && line.length <= 4 && !current.성명 && !line.includes("/") && !line.includes("영역"))
            current.성명 = line;
    });

    if (Object.keys(current).length > 0) students.push(current);

    return students;
}


// 의견 자동 생성기
function generateComments(s, activities, specialNote) {
    const base = [];

    base.push(`${s.성명} 학생은 ${s.영역} 영역에서 보여준 학습 태도와 ${s.평가결과}의 내용을 토대로, 사실에 기반한 성취 모습을 확인할 수 있었습니다.`);
    base.push(`특히 이번 학기에 진행된 ${activities} 활동을 통해 학습 과정에 충실하게 참여하였으며, 이를 통해 지속적인 성장 가능성을 보여주었습니다.`);
    base.push(`앞으로도 ${s.성취기준}에 따른 학습을 꾸준히 이어간다면 더욱 높은 성취에 도달할 수 있을 것으로 기대됩니다.`);

    // 특별 언급 반영
    if (specialNote && specialNote.includes(s.성명)) {
        base.push(`또한, ${specialNote.split(":")[1].trim()} 부분에서 돋보이는 역량을 발휘하며 학습 공동체에 긍정적인 영향을 주었습니다.`);
    }

    return base;
}


// 실행 버튼
document.getElementById("generateBtn").addEventListener("click", async () => {
    const file = document.getElementById("pdfInput").files[0];
    const activities = document.getElementById("activities").value;
    const special = document.getElementById("specialNote").value;

    if (!file) {
        alert("PDF 성적파일을 업로드해주세요!");
        return;
    }

    const pdfText = await extractTextFromPDF(file);
    const students = parseStudents(pdfText);

    const output = document.getElementById("output");
    output.innerHTML = "";

    students.forEach(s => {
        const comments = generateComments(s, activities, special);

        output.innerHTML += `
            <div class="student-block">
                <div class="name">${s.성명}</div>
                <div class="comment">
                    ${comments.map(c => `<p>${c}</p>`).join("")}
                </div>
            </div>
        `;
    });
});
