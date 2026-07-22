const cards=document.getElementById("cards");
const btn=document.getElementById("createBtn");
const input=document.getElementById("faWord");
const category=document.getElementById("category");
const loading=document.getElementById("loading");
const searchInput=document.getElementById("searchInput");
const myWords=document.getElementById("myWords");
const myWordsBtn=document.getElementById("myWordsBtn");
const backBtn=document.getElementById("backBtn");
const filterCategory=document.getElementById("filterCategory");
const quizBtn=document.getElementById("quizBtn");
const quizModal=document.getElementById("quizModal");
const quizContent=document.getElementById("quizContent");
const startQuiz=document.getElementById("startQuiz");
let data=JSON.parse(localStorage.getItem("flashcards")||"[]");
let learned=JSON.parse(localStorage.getItem("learnedWords")||"[]");

render();
renderLearned();

btn.onclick=async()=>{

const fa=input.value.trim();

if(!fa)return;

loading.style.display="block";

try{

const res=await fetch(
"https://translate.googleapis.com/translate_a/single?client=gtx&sl=fa&tl=en&dt=t&q="+encodeURIComponent(fa)
);

const json=await res.json();

const en=json[0][0][0];

const card={
id:Date.now(),
fa,
en,
category:category.value
};

data.unshift(card);

localStorage.setItem("flashcards",JSON.stringify(data));

render();

input.value="";

}catch{

alert("خطا در ترجمه");

}

loading.style.display="none";

};

function render(){

cards.innerHTML="";

const keyword=searchInput.value.trim().toLowerCase();

data
.filter(item=>
item.fa.toLowerCase().includes(keyword) ||
item.en.toLowerCase().includes(keyword)
)
.forEach(item=>{

const temp=document.getElementById("cardTemplate").content.cloneNode(true);

const card=temp.querySelector(".card");
const en=temp.querySelector(".en");
const fa=temp.querySelector(".fa");
const cat=temp.querySelector(".category");
const ok=temp.querySelector(".ok");
const del=temp.querySelector(".delete");
const speak=temp.querySelector(".speak");

en.textContent=item.en;
fa.textContent=item.fa;
cat.textContent=item.category;

card.onclick=e=>{

if(
e.target.classList.contains("ok")||
e.target.classList.contains("delete")||
e.target.classList.contains("speak")
)return;

card.classList.toggle("flip");

};

speak.onclick=e=>{

e.stopPropagation();

speechSynthesis.cancel();

const u=new SpeechSynthesisUtterance(item.en);

u.lang="en-US";
u.rate=.9;

speechSynthesis.speak(u);

};

ok.onclick=e=>{

e.stopPropagation();

learned.unshift(item);

data=data.filter(x=>x.id!==item.id);

localStorage.setItem("flashcards",JSON.stringify(data));
localStorage.setItem("learnedWords",JSON.stringify(learned));

render();
renderLearned();

};

del.onclick=e=>{

e.stopPropagation();

if(!confirm("فلش کارت حذف شود؟")) return;

data=data.filter(x=>x.id!==item.id);

localStorage.setItem("flashcards",JSON.stringify(data));

render();

};

cards.appendChild(temp);

});

}

function renderLearned(){

myWords.innerHTML="";

let list=learned;

if(filterCategory.value!=="همه"){

list=learned.filter(x=>x.category===filterCategory.value);

}

list.forEach(item=>{

const temp=document.getElementById("cardTemplate").content.cloneNode(true);

const card=temp.querySelector(".card");
const en=temp.querySelector(".en");
const fa=temp.querySelector(".fa");
const cat=temp.querySelector(".category");
const ok=temp.querySelector(".ok");
const del=temp.querySelector(".delete");
const speak=temp.querySelector(".speak");

en.textContent=item.en;
fa.textContent=item.fa;
cat.textContent=item.category;

ok.remove();

card.onclick=e=>{

if(
e.target.classList.contains("delete")||
e.target.classList.contains("speak")
)return;

card.classList.toggle("flip");

};

speak.onclick=e=>{

e.stopPropagation();

speechSynthesis.cancel();

const u=new SpeechSynthesisUtterance(item.en);

u.lang="en-US";
u.rate=.9;

speechSynthesis.speak(u);

};

del.onclick=e=>{

e.stopPropagation();

if(!confirm("کلمه حذف شود؟")) return;

learned=learned.filter(x=>x.id!==item.id);

localStorage.setItem("learnedWords",JSON.stringify(learned));

renderLearned();

};

myWords.appendChild(temp);

});

}

filterCategory.onchange=()=>{

renderLearned();

};

myWordsBtn.onclick=()=>{

document.querySelector(".creator").style.display="none";
cards.style.display="none";
loading.style.display="none";

myWords.style.display="grid";
filterCategory.style.display="block";

myWordsBtn.style.display="none";
backBtn.style.display="block";

renderLearned();

};

backBtn.onclick=()=>{

document.querySelector(".creator").style.display="flex";
cards.style.display="grid";

myWords.style.display="none";

filterCategory.style.display="none";
filterCategory.value="همه";

myWordsBtn.style.display="block";
backBtn.style.display="none";

};
searchInput.addEventListener("input",()=>{
render();
});

//================== QUIZ ==================

const questionNumber=document.getElementById("questionNumber");
const questionText=document.getElementById("questionText");
const progressBar=document.getElementById("progressBar");
const answerBtns=document.querySelectorAll(".answerBtn");
const quizStart=document.getElementById("quizStart");
const quizGame=document.getElementById("quizGame");
const quizResult=document.getElementById("quizResult");
const scoreText=document.getElementById("scoreText");
const detailText=document.getElementById("detailText");
const finishQuiz=document.getElementById("finishQuiz");

let quizQuestions=[];
let currentQuestion=0;
let score=0;
let allWords=[];

quizBtn.onclick=()=>{

allWords=[...data,...learned];

console.log("Flashcards:", data.length);
console.log("Learned:", learned.length);
console.log("All:", allWords.length);
if(allWords.length<10){

alert("حداقل باید ۱۰ کلمه داشته باشید.");

return;

}

quizModal.style.display="flex";

quizStart.style.display="block";
quizGame.style.display="none";
quizResult.style.display="none";

};

quizModal.onclick=e=>{

if(e.target===quizModal){

quizModal.style.display="none";

}

};

startQuiz.onclick=()=>{
console.log("Quiz questions:", quizQuestions);
console.log("All words:", allWords);
  
quizQuestions=[...allWords]
.sort(()=>Math.random()-0.5)
.slice(0,10);

currentQuestion=0;
score=0;

quizStart.style.display="none";
quizGame.style.display="block";
quizResult.style.display="none";
console.log("Starting quiz...");
showQuestion();

};

function showQuestion(){

const q=quizQuestions[currentQuestion];

questionNumber.textContent=
`سؤال ${currentQuestion+1} از 10`;

progressBar.style.width=
((currentQuestion)/10*100)+"%";

questionText.textContent=q.fa;

let answers=[q.en];

let randoms=allWords
.filter(x=>x.id!==q.id)
.sort(()=>Math.random()-0.5)
.slice(0,3);

randoms.forEach(x=>answers.push(x.en));

answers=answers.sort(()=>Math.random()-0.5);

const answerBtns=document.querySelectorAll(".answerBtn");

answerBtns.forEach((btn,index)=>{

btn.disabled=false;

btn.style.background="#4d9b7d";

btn.textContent=answers[index];

btn.onclick=()=>{

speechSynthesis.cancel();

const u=new SpeechSynthesisUtterance(btn.textContent);

u.lang="en-US";
u.rate=0.9;

speechSynthesis.speak(u);
answerBtns.forEach(b=>b.disabled=true);

if(btn.textContent===q.en){

score++;

btn.style.background="#22c55e";

}else{

btn.style.background="#ef4444";

answerBtns.forEach(b=>{

if(b.textContent===q.en){

b.style.background="#22c55e";

}

});

}

setTimeout(nextQuestion,1000);

};

});

}

function nextQuestion(){

currentQuestion++;

if(currentQuestion>=10){

showResult();

return;

}

showQuestion();

}

function showResult(){

quizGame.style.display="none";

quizResult.style.display="block";

progressBar.style.width="100%";

scoreText.textContent=`امتیاز شما : ${score} از 10`;

let msg="";

if(score==10){

msg="🏆 عالی بود! همه جواب‌ها درست بودند.";

}else if(score>=8){

msg="🌟 خیلی خوب! فقط چند اشتباه داشتی.";

}else if(score>=6){

msg="👍 خوب بود، کمی بیشتر تمرین کن.";

}else if(score>=4){

msg="📚 نیاز به تمرین بیشتری داری.";

}else{

msg="💪 دوباره امتحان کن، موفق میشی.";

}

detailText.textContent=msg;

}

finishQuiz.onclick=()=>{

quizModal.style.display="none";

quizStart.style.display="block";

quizGame.style.display="none";

quizResult.style.display="none";

progressBar.style.width="0%";


}
//================ WORD GAME ================

const gameBtn=document.getElementById("gameBtn");
const wordGame=document.getElementById("wordGame");
const fallingArea=document.getElementById("fallingArea");
const gameTarget=document.getElementById("gameTarget");
const gameScore=document.getElementById("gameScore");
const closeGame=document.getElementById("closeGame");

let gameScoreNum=0;
let targetWord=null;
let gameRunning=false;
let roundTimer=null;



// سرعت اولیه
let gameSpeed=8;
let bestScore=Number(localStorage.getItem("bestScore")||0);

document.getElementById("bestScore").textContent=bestScore;

gameBtn.onclick=()=>{

const allWords=[...data,...learned];

if(allWords.length<4){
alert("حداقل ۴ کلمه لازم است");
return;
}

gameRunning=true;
gameScoreNum=0;
gameSpeed=8;

gameScore.textContent="0";

wordGame.style.display="block";

startRound();

};

function startRound(){

if(!gameRunning)return;

const allWords=[...data,...learned];

fallingArea.innerHTML="";

targetWord=
allWords[Math.floor(Math.random()*allWords.length)];

gameTarget.textContent="معنی : "+targetWord.fa;


// ساخت گزینه‌ها
let options=[targetWord.en];

while(options.length<4){

let w=
allWords[Math.floor(Math.random()*allWords.length)].en;

if(!options.includes(w)){

options.push(w);

}

}

options.sort(()=>Math.random()-0.5);


// ---------- مسیرهای حرکت ----------

const laneCount=12;

const laneWidth=
fallingArea.clientWidth/laneCount;

let lanes=[];

for(let i=0;i<laneCount;i++){

lanes.push(i);

}

// مسیرها را مخلوط کن
lanes.sort(()=>Math.random()-0.5);


// ---------- ساخت کلمات ----------

options.forEach((word,index)=>{

const div=document.createElement("div");

div.className="fallWord";

div.textContent=word;


// هر کلمه یک مسیر جدا
let lane=lanes[index];

let left=
lane*laneWidth+
(Math.random()*(laneWidth-90));


// از کادر بیرون نزند
left=Math.max(5,left);

left=Math.min(
left,
fallingArea.clientWidth-110
);


div.style.left=left+"px";

div.style.top="-60px";


// هر کلمه کمی دیرتر شروع شود
div.style.animationDelay=
(index*0.35)+"s";


// سرعت
div.style.animationDuration=
gameSpeed+"s";


div.onclick=()=>{

checkAnswer(word);

};


fallingArea.appendChild(div);

});


clearTimeout(roundTimer);

roundTimer=setTimeout(()=>{

if(gameRunning){

alert("⏰ زمان تمام شد");

endGame();

}

},(gameSpeed+2)*1000);

}
function checkAnswer(selected){

if(!gameRunning)return;

clearTimeout(roundTimer);

// همه کلمات غیرقابل کلیک شوند
document.querySelectorAll(".fallWord").forEach(w=>{
w.style.pointerEvents="none";
});

if(selected===targetWord.en){

gameScoreNum++;

gameScore.textContent=gameScoreNum;

  if(gameScoreNum>bestScore){

bestScore=gameScoreNum;

localStorage.setItem("bestScore",bestScore);

document.getElementById("bestScore").textContent=bestScore;

  }
// افزایش سرعت
if(gameScoreNum>=10 && gameScoreNum<20){
gameSpeed=7;
}else if(gameScoreNum>=20 && gameScoreNum<30){
gameSpeed=6;
}else if(gameScoreNum>=30 && gameScoreNum<40){
gameSpeed=5;
}else if(gameScoreNum>=40 && gameScoreNum<50){
gameSpeed=4;
}else if(gameScoreNum>=50){
gameSpeed=3;
}

// محو شدن کلمات
document.querySelectorAll(".fallWord").forEach(w=>{
w.style.transition=".25s";
w.style.opacity="0";
});

setTimeout(()=>{

if(gameRunning){

startRound();

}

},300);

}else{

gameScoreNum--;

gameScore.textContent=gameScoreNum;

// قرمز شدن جواب اشتباه
document.querySelectorAll(".fallWord").forEach(w=>{

if(w.textContent===selected){

w.style.background="#ef4444";

}

if(w.textContent===targetWord.en){

w.style.background="#22c55e";

}

});

if(gameScoreNum<0){

setTimeout(()=>{

alert("💀 امتیازت منفی شد!\n\nبازی تمام شد.");

endGame();

},700);

return;

}

setTimeout(()=>{

if(gameRunning){

startRound();

}

},800);

}

}


function endGame(){

gameRunning=false;

clearTimeout(roundTimer);

fallingArea.innerHTML="";

wordGame.style.display="none";

}


closeGame.onclick=()=>{

endGame();

};

//================ CROSSWORD GAME ================

const crosswordBtn=document.getElementById("crosswordBtn");
const crosswordGame=document.getElementById("crosswordGame");
const crosswordGrid=document.getElementById("crosswordGrid");
const crosswordClues=document.getElementById("crosswordClues");
const closeCrossword=document.getElementById("closeCrossword");


let crosswordSize=12;
let crosswordBoard=[];


// باز کردن جدول
crosswordBtn.onclick=()=>{

let words=[...data,...learned];

if(words.length<5){

alert("حداقل ۵ کلمه لازم است");

return;

}


// فقط کلمات انگلیسی
words=words
.map(x=>x.en.toUpperCase())
.filter(x=>x.length>=3 && x.length<=10);


// انتخاب تصادفی ۸ کلمه
words.sort(()=>Math.random()-0.5);

words=words.slice(0,8);


createCrossword(words);

crosswordGame.style.display="block";

};



// ساخت جدول

function createCrossword(words){


crosswordBoard=[];


for(let y=0;y<crosswordSize;y++){

crosswordBoard[y]=[];

for(let x=0;x<crosswordSize;x++){

crosswordBoard[y][x]="";

}

}


// اولین کلمه وسط

let first=words[0];

let startX=Math.floor((crosswordSize-first.length)/2);

let startY=Math.floor(crosswordSize/2);


for(let i=0;i<first.length;i++){

crosswordBoard[startY][startX+i]=first[i];

}



// بقیه کلمات

for(let i=1;i<words.length;i++){

placeWord(words[i]);

}


drawCrossword();

}




// قرار دادن کلمات با حرف مشترک

function placeWord(word){


for(let y=0;y<crosswordSize;y++){

for(let x=0;x<crosswordSize;x++){


for(let i=0;i<word.length;i++){


let cell=crosswordBoard[y][x];


if(cell===word[i]){


// عمودی امتحان کن

if(canPlaceVertical(word,x,y-i)){


for(let j=0;j<word.length;j++){

crosswordBoard[y-i+j][x]=word[j];

}

return;

}


// افقی امتحان کن

if(canPlaceHorizontal(word,x-i,y)){


for(let j=0;j<word.length;j++){

crosswordBoard[y][x-i+j]=word[j];

}

return;

}


}


}


}


}


}




function canPlaceVertical(word,x,y){

if(y<0 || y+word.length>crosswordSize)
return false;


for(let i=0;i<word.length;i++){

let c=crosswordBoard[y+i][x];

if(c!=="" && c!==word[i])
return false;

}

return true;

}



function canPlaceHorizontal(word,x,y){

if(x<0 || x+word.length>crosswordSize)
return false;


for(let i=0;i<word.length;i++){

let c=crosswordBoard[y][x+i];

if(c!=="" && c!==word[i])
return false;

}

return true;

  }
function drawCrossword(){

crosswordGrid.innerHTML="";

for(let y=0;y<crosswordSize;y++){

for(let x=0;x<crosswordSize;x++){

let cell=document.createElement("div");

cell.className="crossCell";


if(crosswordBoard[y][x]!==""){

cell.textContent=crosswordBoard[y][x];

}else{

cell.classList.add("blackCell");

}


crosswordGrid.appendChild(cell);

}

}


crosswordClues.innerHTML=
"<h3>جدول ساخته شد</h3>";

}


closeCrossword.onclick=()=>{

crosswordGame.style.display="none";

};
